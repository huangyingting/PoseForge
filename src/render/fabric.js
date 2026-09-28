/**
 * Cloth, as the surface it is.
 *
 * What made the garments read as paint was not their colour or their shading
 * but that there was nothing in them: one roughness and one normal from the
 * collar to the hem, which is what a coat of paint is and what no fabric ever
 * is. A knit is a surface of loops, a band is ribbed, cloth on a body creases
 * where the body folds, and dyed yarn is never one colour. Each of those is a
 * tile here:
 *
 * - `knitTile` - plain jersey, the face of a T-shirt: columns of V-shaped
 *   loops, each leg a round yarn with its ply twisted into it, and every loop
 *   a little different from the next;
 * - `ribTile` - the ribbing of a collar or a waistband, raised columns with
 *   sunk ones between;
 * - `grainTile` - leather's pebbled grain, a skin of small domes with creases
 *   between and pores in them;
 * - `foldTile` - the soft creases cloth takes on a body, long across the
 *   figure rather than down it, which is how a fitted top wrinkles;
 * - `heatherTile` - the colour's wander, streaked along the course of the yarn
 *   for a knit and blotched for a hide;
 * - `reliefTile` - a height made of a mask, for the lace, whose threads stand
 *   off the net;
 * - `weaveTile` - plain weave, over one and under the next, for what is woven
 *   rather than knitted: curtains, sheets, a flat rug.
 *
 * All of them are square RGBA byte arrays that tile exactly, so none of them
 * needs anything but the renderer's own way of wrapping bytes, and all are
 * seeded, so every run weaves the same cloth. Normals are tangent space, +z
 * out of the cloth, in the convention three reads them in; a roughness tile
 * carries the roughness factor in green (where three reads it) over
 * `ROUGHNESS_SPAN`, so the factor can go above one, and a cavity in red - how
 * much of the light reaching that point of the tile gets into the hollow it is
 * at the bottom of - for the diffuse. The noise and the normals are shared
 * with `surfaces.js`, which does the same for the room's wood and plaster.
 *
 * The body's UV atlas runs at about a metre and three quarters of skin to the
 * unit, and on the trunk and the legs its `v` runs up the figure, so the knit's
 * wales and the rib's columns are laid down `v` and stand up the body where it
 * matters. On the arms the charts are turned, and so is the knit, which at a
 * loop's size is not something the eye can find.
 */

/** Over what a roughness tile's green is stored; see the header. */
export const ROUGHNESS_SPAN = 1.3;

/** A seeded generator in [0, 1): the same mulberry32 the skin's detail uses. */
function seeded(seed) {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const byte = (v) => Math.round(clamp01(v) * 255);
/** A round thread's height across it, and nothing outside it. */
const round = (d, half) => (Math.abs(d) < half ? Math.sqrt(1 - (d / half) ** 2) : -Infinity);

/**
 * Smooth noise over an `n`-texel square that tiles: `cu` lattice cells across
 * and `cv` down, which is how it is stretched - fewer cells one way than the
 * other draws features long that way.
 */
function valueNoise(random, n, cu, cv = cu) {
  const lattice = Float32Array.from({ length: cu * cv }, random);
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y += 1) {
    const gy = (y / n) * cv;
    const j = Math.floor(gy);
    const sy = smooth(gy - j);
    const j0 = (j % cv) * cu;
    const j1 = ((j + 1) % cv) * cu;
    for (let x = 0; x < n; x += 1) {
      const gx = (x / n) * cu;
      const i = Math.floor(gx);
      const sx = smooth(gx - i);
      const i0 = i % cu;
      const i1 = (i + 1) % cu;
      const top = lattice[j0 + i0] + (lattice[j0 + i1] - lattice[j0 + i0]) * sx;
      const bottom = lattice[j1 + i0] + (lattice[j1 + i1] - lattice[j1 + i0]) * sx;
      out[y * n + x] = top + (bottom - top) * sy;
    }
  }
  return out;
}

/**
 * A height field as a tangent-space normal map. `strength` is the rise, in
 * texels, of a unit of height - how steep the relief is, independent of how
 * finely the tile is drawn.
 */
function normals(height, n, strength) {
  const data = new Uint8Array(n * n * 4);
  const at = (x, y) => height[((y + n) % n) * n + ((x + n) % n)];
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const sx = (at(x + 1, y) - at(x - 1, y)) * 0.5 * strength;
      const sy = (at(x, y + 1) - at(x, y - 1)) * 0.5 * strength;
      const length = Math.hypot(sx, sy, 1);
      const o = (y * n + x) * 4;
      data[o] = byte(-sx / length * 0.5 + 0.5);
      data[o + 1] = byte(-sy / length * 0.5 + 0.5);
      data[o + 2] = byte(1 / length * 0.5 + 0.5);
      data[o + 3] = 255;
    }
  }
  return data;
}

/**
 * Cavity and roughness factor, per texel, as a tile three can read - and the
 * average of each, which is what the tile comes to once the mipmaps have
 * averaged it away across the room, so that a caller can divide it back out
 * and have the cloth, seen from far enough off, be the colour and the gloss it
 * was before it had any texture at all.
 */
function roughnessData(n, cavity, factor) {
  const data = new Uint8Array(n * n * 4);
  let cavities = 0;
  let factors = 0;
  for (let i = 0; i < n * n; i += 1) {
    data[i * 4] = byte(cavity(i));
    data[i * 4 + 1] = byte(factor(i) / ROUGHNESS_SPAN);
    data[i * 4 + 2] = 0;
    data[i * 4 + 3] = 255;
    cavities += data[i * 4] / 255;
    factors += (data[i * 4 + 1] / 255) * ROUGHNESS_SPAN;
  }
  return { data, cavity: cavities / (n * n), factor: factors / (n * n) };
}

/**
 * Plain jersey.
 *
 * Each wale is a column of loops and each loop, seen from the face, two legs
 * leaning in to meet at its foot - the V a knit is recognisable by. A leg is a
 * round yarn in section, highest along its middle, and it dives at both ends
 * where it passes under the loops above and below; the ply of the yarn twists
 * across it; and every loop is a little fatter or thinner than the one beside
 * it, because hand or machine, a knit is never even. The fuzz is the fibre
 * ends, and is what keeps the hollows from being clean.
 *
 * @returns {{size: number, normal: Uint8Array, roughness: {data: Uint8Array, cavity: number, factor: number}}}
 */
export function knitTile({ size = 256, wales = 16, courses = 20, seed = 0x6b6e6974, depth = 1 } = {}) {
  const n = size;
  const random = seeded(seed);
  const jitter = Float32Array.from({ length: wales * courses * 2 }, () => random() - 0.5);
  const fuzz = valueNoise(random, n, 64);
  const height = new Float32Array(n * n);
  for (let y = 0; y < n; y += 1) {
    const gy = (y / n) * courses;
    const j = Math.floor(gy) % courses;
    const v = gy - Math.floor(gy);
    for (let x = 0; x < n; x += 1) {
      const gx = (x / n) * wales;
      const i = Math.floor(gx) % wales;
      const u = gx - Math.floor(gx) - 0.5;
      let h = 0;
      for (const [k, side] of [[0, -1], [1, 1]]) {
        const swell = 1 + 0.3 * jitter[(j * wales + i) * 2 + k];
        const centre = side * (0.34 - 0.22 * v);
        const across = (u - centre) / (0.19 * swell);
        if (Math.abs(across) >= 1) continue;
        const round = Math.sqrt(1 - across * across);
        const dive = 0.5 + 0.5 * Math.sin(Math.PI * v);
        const ply = 1 + 0.1 * Math.sin(2 * Math.PI * (v * 4 + side * across * 0.6));
        h = Math.max(h, round * dive * ply * swell);
      }
      height[y * n + x] = h + 0.12 * (fuzz[y * n + x] - 0.5);
    }
  }
  return {
    size: n,
    normal: normals(height.map((h) => h * depth), n, 0.9),
    // A hollow between loops holds what falls into it, and its fibres face
    // every way, so it is darker and rougher than the crown of a leg.
    roughness: roughnessData(
      n,
      (i) => 0.62 + 0.38 * Math.min(1, height[i] * 1.4),
      (i) => 0.86 + 0.26 * (1 - Math.min(1, height[i])) + 0.1 * (fuzz[i] - 0.5)
    ),
  };
}

/**
 * Ribbing: columns alternately knitted and purled, so every other one stands
 * proud and the ones between sink, and each proud column is itself a stack of
 * loops.
 *
 * @returns {{size: number, normal: Uint8Array}}
 */
export function ribTile({ size = 128, ribs = 8, courses = 16, seed = 0x72696221 } = {}) {
  const n = size;
  const random = seeded(seed);
  const fuzz = valueNoise(random, n, 32);
  const height = new Float32Array(n * n);
  for (let y = 0; y < n; y += 1) {
    const v = ((y / n) * courses) % 1;
    for (let x = 0; x < n; x += 1) {
      const u = ((x / n) * ribs) % 1;
      // A proud column across the middle half of each rib, a sunk one across
      // the rest; the loops show as a slight waist at every course.
      const column = Math.cos(2 * Math.PI * (u - 0.25));
      const proud = Math.max(0, column) ** 0.6;
      const loops = 1 - 0.18 * Math.cos(2 * Math.PI * v) ** 2;
      height[y * n + x] = proud * loops + 0.08 * (fuzz[y * n + x] - 0.5);
    }
  }
  return { size: n, normal: normals(height, n, 2.2) };
}

/**
 * Leather's grain: the outer skin of the hide, a crazing of shallow creases
 * round slightly domed cells, with a pore here and there. The crowns are what
 * the hide has been rubbed and polished on, so they are smoother than the
 * creases between.
 *
 * @returns {{size: number, normal: Uint8Array, roughness: {data: Uint8Array, cavity: number, factor: number}}}
 */
export function grainTile({ size = 256, cells = 22, seed = 0x6869_6465 } = {}) {
  const n = size;
  const random = seeded(seed);
  const pitch = n / cells;
  const seeds = Array.from({ length: cells * cells }, (_, i) => [
    ((i % cells) + 0.15 + 0.7 * random()) * pitch,
    (Math.floor(i / cells) + 0.15 + 0.7 * random()) * pitch,
  ]);
  const height = new Float32Array(n * n);
  const crease = new Float32Array(n * n);
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const cx = Math.floor(x / pitch);
      const cy = Math.floor(y / pitch);
      let f1 = Infinity;
      let f2 = Infinity;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const gx = cx + dx;
          const gy = cy + dy;
          const [sx, sy] = seeds[(((gy % cells) + cells) % cells) * cells + (((gx % cells) + cells) % cells)];
          const d = Math.hypot(sx + Math.floor(gx / cells) * n - x, sy + Math.floor(gy / cells) * n - y);
          if (d < f1) [f1, f2] = [d, f1];
          else if (d < f2) f2 = d;
        }
      }
      const edge = Math.exp(-(((f2 - f1) / 1.6) ** 2));
      crease[y * n + x] = edge;
      height[y * n + x] = 0.35 * Math.cos(Math.min(1, f1 / pitch) * Math.PI * 0.5) - edge;
    }
  }
  const pores = cells * 2;
  for (let p = 0; p < pores * pores * 0.25; p += 1) {
    const x0 = random() * n;
    const y0 = random() * n;
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const x = ((Math.round(x0) + dx) % n + n) % n;
        const y = ((Math.round(y0) + dy) % n + n) % n;
        const d2 = (Math.round(x0) + dx - x0) ** 2 + (Math.round(y0) + dy - y0) ** 2;
        height[y * n + x] -= 0.4 * Math.exp(-d2 / 1.2);
      }
    }
  }
  return {
    size: n,
    normal: normals(height, n, 1.1),
    roughness: roughnessData(
      n,
      (i) => 1 - 0.3 * crease[i],
      (i) => 0.85 + 0.45 * crease[i] + 0.2 * Math.max(0, -height[i] - 0.5)
    ),
  };
}

/**
 * Creases, the few centimetres long soft ones cloth takes where it is gathered.
 *
 * Drawn as the contour lines of a smooth noise: a crease is a narrow ridge with
 * a wide gentle trough either side, and it wanders, forks and fades out the way
 * the level set of a smooth field does. The noise has fewer cells across `u`
 * than down `v`, so the contours run long across the figure, which is the way
 * a fitted top rucks at the waist and in the small of the back.
 *
 * @returns {{size: number, normal: Uint8Array}}
 */
export function foldTile({ size = 256, seed = 0x666f6c64 } = {}) {
  const n = size;
  const random = seeded(seed);
  const broad = valueNoise(random, n, 2, 9);
  const fine = valueNoise(random, n, 5, 18);
  const fade = valueNoise(random, n, 5, 3);
  const height = new Float32Array(n * n);
  for (let i = 0; i < n * n; i += 1) {
    const field = 0.78 * broad[i] + 0.22 * fine[i];
    // Several contour levels, so creases come in families rather than alone.
    let h = 0;
    for (const level of [0.3, 0.42, 0.54, 0.66]) {
      const d = (field - level) / 0.03;
      h += Math.exp(-d * d) - 0.35 * Math.exp(-d * d * 0.12);
    }
    height[i] = h * smooth(clamp01((fade[i] - 0.2) / 0.6));
  }
  return { size: n, normal: normals(height, n, 3) };
}

/**
 * How far the colour of the cloth wanders from its average. A knit's is
 * streaked along the course, since a course is one length of yarn and yarn
 * takes the dye unevenly along its length; a hide's is blotched. Grey, between
 * about 0.9 and 1, to multiply the colour by.
 *
 * @returns {{size: number, map: Uint8Array, mean: number}}
 */
export function heatherTile({ size = 256, streaked = true, seed = 0x68656174 } = {}) {
  const n = size;
  const random = seeded(seed);
  const [a, b] = streaked
    ? [valueNoise(random, n, 10, 96), valueNoise(random, n, 4, 24)]
    : [valueNoise(random, n, 12), valueNoise(random, n, 4)];
  const map = new Uint8Array(n * n * 4);
  let sum = 0;
  for (let i = 0; i < n * n; i += 1) {
    const value = byte(0.955 + 0.06 * (a[i] - 0.5) + 0.05 * (b[i] - 0.5));
    map.fill(value, i * 4, i * 4 + 3);
    map[i * 4 + 3] = 255;
    sum += value / 255;
  }
  return { size: n, map, mean: sum / (n * n) };
}

/**
 * A mask stood up into relief: thread where the mask is, rounded over by a
 * blur, so a lace's cords and flowers stand off its net.
 *
 * @param {Uint8Array} mask one byte a texel, `size` square
 * @returns {{size: number, normal: Uint8Array}}
 */
export function reliefTile(mask, size, { radius = 2, strength = 1.6 } = {}) {
  const n = size;
  let height = Float32Array.from(mask, (m) => m / 255);
  // A box blur twice over, which is near enough a gaussian for a cord.
  for (let pass = 0; pass < 2; pass += 1) {
    for (const horizontal of [true, false]) {
      const next = new Float32Array(n * n);
      for (let y = 0; y < n; y += 1) {
        for (let x = 0; x < n; x += 1) {
          let sum = 0;
          for (let k = -radius; k <= radius; k += 1) {
            const sx = horizontal ? (x + k + n) % n : x;
            const sy = horizontal ? y : (y + k + n) % n;
            sum += height[sy * n + sx];
          }
          next[y * n + x] = sum / (2 * radius + 1);
        }
      }
      height = next;
    }
  }
  return { size: n, normal: normals(height, n, strength) };
}

/**
 * Plain weave: the linen of a curtain, the percale of a sheet, a kilim.
 *
 * Warp down `v` and weft across `u`, each thread passing over one and under the
 * next, so every crossing has one thread on top and its neighbours the other
 * way round - the chequer a woven cloth is recognisable by close to. A thread
 * is round in section and rises and dives along its length as it goes over and
 * under; it is fatter in places, the slubs a linen yarn has; and each takes the
 * dye a little differently from the one beside it, which from further off is
 * the faint streak down and across a curtain that a painted one does not have.
 *
 * @returns {{size: number, normal: Uint8Array, map: Uint8Array, mean: number}}
 */
export function weaveTile({ size = 256, threads = 16, slub = 0.3, strength = 3.5, seed = 0x6c696e65 } = {}) {
  const n = size;
  const random = seeded(seed);
  // Along each thread: how fat it is, and how dark. Few cells along a thread,
  // and read across it only at the thread's middle, which with two cells to a
  // thread is a lattice point of its own - so each wanders on its own.
  const warpSlub = valueNoise(random, n, 2 * threads, 6);
  const weftSlub = valueNoise(random, n, 6, 2 * threads);
  const warpTone = valueNoise(random, n, 2 * threads, 3);
  const weftTone = valueNoise(random, n, 3, 2 * threads);
  const middle = (t) => Math.floor(((t + 0.5) * n) / threads);
  const height = new Float32Array(n * n);
  const map = new Uint8Array(n * n * 4);
  let sum = 0;
  for (let y = 0; y < n; y += 1) {
    const gy = (y / n) * threads;
    const j = Math.floor(gy);
    const fy = gy - j - 0.5;
    for (let x = 0; x < n; x += 1) {
      const gx = (x / n) * threads;
      const i = Math.floor(gx);
      const fx = gx - i - 0.5;
      const k = y * n + x;
      const warpAt = y * n + middle(i);
      const weftAt = middle(j) * n + x;
      // Over at a crossing where i + j is even, under where it is odd - and
      // the weft the other way round.
      const warpRise = 0.5 * Math.cos(Math.PI * (gy - 0.5 + i));
      const weftRise = -0.5 * Math.cos(Math.PI * (gx - 0.5 + j));
      const warpHalf = 0.34 * (1 + slub * (warpSlub[warpAt] - 0.5) * 2);
      const weftHalf = 0.34 * (1 + slub * (weftSlub[weftAt] - 0.5) * 2);
      const warp = warpRise + 0.45 * round(fx, warpHalf);
      const weft = weftRise + 0.45 * round(fy, weftHalf);
      const top = Math.max(warp, weft, -0.9);
      height[k] = top;
      const tone = top === warp ? warpTone[warpAt] : top === weft ? weftTone[weftAt] : 0.2;
      // The gaps between the threads are the shade under them.
      const shade = top === -0.9 ? 0.82 : 0.97 + 0.07 * (tone - 0.5) + 0.02 * top;
      const value = byte(shade);
      map.fill(value, k * 4, k * 4 + 3);
      map[k * 4 + 3] = 255;
      sum += value / 255;
    }
  }
  return { size: n, normal: normals(height, n, strength * (threads / n) * 16), map, mean: sum / (n * n) };
}

export { normals, roughnessData, seeded, valueNoise };
