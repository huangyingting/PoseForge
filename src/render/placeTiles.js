/**
 * The pictures of the places that are not rooms (see `places.js`): sand, the
 * sea's ripples and the foam at its edge, a beach towel, the stone round a pool,
 * the mosaic in it and the light the water throws on that, a studio's concrete
 * floor - and, for the hotel room, a city at night through its window.
 *
 * In the conventions of the room's (see `roomTiles.js` and `surfaces.js`):
 * bytes and nothing but arithmetic on seeded noise, so the worker and the page
 * make the same ones; every tile meets itself across its edges; normals are in
 * tangent space and roughness in green over `ROUGHNESS_SPAN`; and where the
 * material gives the colour, the tile's `map` is a grey to multiply it by, with
 * its `mean` to divide back out.
 */

import { normals, roughnessData, seeded, valueNoise } from "./fabric.js";

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const byte = (v) => Math.round(clamp01(v) * 255);
const smooth = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

function grey(n, value) {
  const map = new Uint8Array(n * n * 4);
  let sum = 0;
  for (let i = 0; i < n * n; i += 1) {
    const v = byte(value(i));
    map.fill(v, i * 4, i * 4 + 3);
    map[i * 4 + 3] = 255;
    sum += v / 255;
  }
  return { map, mean: sum / (n * n) };
}

/**
 * Dry sand, a metre of it: the ripples the wind leaves, a hand apart, each
 * gentle on the side the wind came from and steep on the other, wandering and
 * dying out across the beach; the grains over them; and among the pale grains
 * the odd dark one and the odd bright one, which is what tells sand from a
 * beige floor at any distance the eye can still see grains.
 *
 * @returns {{size: number, normal: Uint8Array, map: Uint8Array, mean: number}}
 */
export function sandTile({ size = 512, seed = 0x73616e64 } = {}) {
  const n = size;
  const random = seeded(seed);
  const warp = valueNoise(random, n, 3, 5);
  const wander = valueNoise(random, n, 7, 11);
  const fade = valueNoise(random, n, 4, 3);
  const grains = valueNoise(random, n, 256);
  const fine = valueNoise(random, n, 96);
  const patch = valueNoise(random, n, 5);
  const height = new Float32Array(n * n);
  const tone = new Float32Array(n * n);
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const i = y * n + x;
      // Twelve ripples to the metre, so the tile's edges meet.
      const phase = (y / n) * 12 + 1.8 * warp[i] + 0.45 * wander[i];
      const s = phase - Math.floor(phase);
      const ridge = s < 0.72 ? s / 0.72 : (1 - s) / 0.28;
      const ripple = ridge * ridge * (3 - 2 * ridge) * smooth(0.15, 0.65, fade[i]);
      height[i] = 1.3 * ripple + 0.12 * grains[i] + 0.25 * fine[i];
      const fleck = random();
      tone[i] =
        1 + 0.06 * (patch[i] - 0.5) + 0.08 * (grains[i] - 0.5) + 0.03 * ripple +
        (fleck > 0.988 ? -0.32 : fleck < 0.008 ? 0.12 : 0);
    }
  }
  const { map, mean } = grey(n, (i) => 0.86 * tone[i]);
  return { size: n, normal: normals(height, n, 3.2), map, mean };
}

/**
 * The sea's surface, three metres of it: a few trains of small waves from
 * different quarters over a slow swell, and the wind's chop over those. Whole
 * numbers of waves to a tile, each bent by a noise that tiles, so it tiles.
 *
 * @returns {{size: number, normal: Uint8Array}}
 */
export function waterTile({ size = 256, seed = 0x77617465 } = {}) {
  const n = size;
  const random = seeded(seed);
  const swell = valueNoise(random, n, 3, 4);
  const chop = valueNoise(random, n, 18);
  const fine = valueNoise(random, n, 44);
  const waves = Array.from({ length: 6 }, (_, k) => ({
    fx: Math.round((random() * 2 - 1) * (2 + k * 2)),
    fy: 2 + Math.floor(random() * (2 + k * 2)),
    phase: random() * Math.PI * 2,
    amp: 1 / (1 + k * 0.7),
  }));
  const height = new Float32Array(n * n);
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const i = y * n + x;
      let h = 0;
      for (const { fx, fy, phase, amp } of waves)
        h += amp * Math.sin(2 * Math.PI * ((fx * x) / n + (fy * y) / n) + phase + 2.2 * swell[i]);
      height[i] = 2.4 * h + 2.6 * chop[i] + 0.8 * fine[i];
    }
  }
  return { size: n, normal: normals(height, n, 0.9) };
}

/**
 * The foam a wave leaves as it runs out up the sand: a band along the middle
 * of the tile, lace at its edges where the bubbles have burst, white. Tiled
 * along `u`, the shore; drawn once across `v`.
 *
 * @returns {{width: number, height: number, data: Uint8Array}}
 */
export function foamTile() {
  const w = 256;
  const h = 64;
  const random = seeded(0xf0a3);
  const lace = valueNoise(random, w, 40, 40);
  const cells = valueNoise(random, w, 90, 90);
  const edge = valueNoise(random, w, 6, 6);
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    const v = y / (h - 1);
    for (let x = 0; x < w; x += 1) {
      const i = y * 4 * w + x;
      const off = Math.abs(v - 0.5 - 0.18 * (edge[i] - 0.5)) * 2;
      const band = 1 - smooth(0.25, 0.95, off);
      const bubbles = smooth(0.38, 0.62, 0.6 * lace[i] + 0.4 * cells[i] + 0.35 * band - 0.2);
      const o = (y * w + x) * 4;
      data.fill(255, o, o + 3);
      data[o + 3] = byte(band * bubbles * 0.95);
    }
  }
  return { width: w, height: h, data };
}

/**
 * A beach towel's stripes, wide and narrow across its length, and the loops of
 * the terry as noise over them. Drawn once across the towel.
 *
 * @param {number[][]} colours three, as the channels three would store
 * @returns {{width: number, height: number, data: Uint8Array}}
 */
export function towelTile([wide, other, line]) {
  const w = 256;
  const h = 512;
  const random = seeded(0x70e1);
  const loops = valueNoise(random, w, 128, 128);
  const tone = valueNoise(random, w, 8, 8);
  // The bands from one end to the other, in metres of a towel two long.
  const bands = [
    [0.1, line], [0.04, wide], [0.025, line], [0.16, wide], [0.05, other], [0.025, line], [0.05, other],
    [0.3, wide], [0.05, other], [0.025, line], [0.05, other], [0.16, wide], [0.025, line], [0.04, wide], [0.1, line],
  ];
  const total = bands.reduce((sum, [length]) => sum + length, 0);
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    let along = (y / (h - 1)) * total;
    let colour = bands[0][1];
    for (const [length, band] of bands) {
      colour = band;
      if (along < length) break;
      along -= length;
    }
    for (let x = 0; x < w; x += 1) {
      const i = (y % w) * w + x;
      const shade = 1 + 0.12 * (loops[i] - 0.5) + 0.05 * (tone[i] - 0.5);
      const o = (y * w + x) * 4;
      for (let k = 0; k < 3; k += 1) data[o + k] = byte(colour[k] * shade);
      data[o + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

/**
 * Honed travertine round a pool, 1.2 m of it: slabs 60 cm by 40 in rows that
 * each step a third of a slab along, so three rows come back round and the
 * tile meets itself; each slab its own tone, banded the way the stone was laid
 * down, pitted with the small holes it is known by, the edges eased and the
 * joints sunk and filled with a grout a shade paler.
 *
 * @returns {{size: number, normal: Uint8Array, roughness: object, map: Uint8Array, mean: number}}
 */
export function paverTile({ size = 512, seed = 0x74726176 } = {}) {
  const n = size;
  const random = seeded(seed);
  const bands = valueNoise(random, n, 3, 40);
  const cloud = valueNoise(random, n, 6);
  const pits = valueNoise(random, n, 64, 170);
  const fine = valueNoise(random, n, 128);
  const rows = 3;
  const across = 2;
  const tones = Array.from({ length: rows * across }, () => random() - 0.5);
  const height = new Float32Array(n * n);
  const tone = new Float32Array(n * n);
  const rough = new Float32Array(n * n);
  const rowHeight = n / rows;
  const slab = n / across;
  for (let y = 0; y < n; y += 1) {
    const r = Math.floor(y / rowHeight);
    const inRow = y - r * rowHeight;
    for (let x = 0; x < n; x += 1) {
      const i = y * n + x;
      const shifted = (x + (r * slab) / rows) % n;
      const c = Math.floor(shifted / slab);
      const inSlab = shifted - c * slab;
      const edge = Math.min(inRow, rowHeight - inRow, inSlab, slab - inSlab);
      const pit = smooth(0.8, 0.9, pits[i]);
      const joint = edge < 1.4;
      const ease = edge < 4 ? (1 - edge / 4) ** 2 : 0;
      height[i] = joint ? -2.2 : -1.4 * ease - 1.6 * pit + 0.15 * fine[i];
      tone[i] = joint
        ? 1.04
        : 1 + 0.08 * tones[r * across + c] + 0.07 * (bands[i] - 0.5) + 0.05 * (cloud[i] - 0.5) - 0.22 * pit;
      rough[i] = joint ? 1.15 : 0.95 + 0.25 * pit;
    }
  }
  const { map, mean } = grey(n, (i) => 0.9 * tone[i]);
  return { size: n, normal: normals(height, n, 1.1), roughness: roughnessData(n, () => 1, (i) => rough[i]), map, mean };
}

/**
 * A pool's glass mosaic, 40 cm of it: tiles two and a half centimetres square
 * in a few blues mixed at random, the way a pool is laid, their faces glossy
 * and a little domed, the grout between them matte and set back.
 *
 * @returns {{size: number, map: Uint8Array, normal: Uint8Array, roughness: object}}
 */
export function mosaicTile({ size = 512, count = 16, seed = 0x6d6f7361 } = {}) {
  const n = size;
  const random = seeded(seed);
  const palette = [
    [0.36, 0.66, 0.78],
    [0.28, 0.58, 0.74],
    [0.45, 0.74, 0.82],
    [0.22, 0.5, 0.68],
    [0.55, 0.8, 0.86],
  ];
  const pick = Array.from({ length: count * count }, () => {
    const roll = random();
    return roll < 0.32 ? 0 : roll < 0.6 ? 1 : roll < 0.8 ? 2 : roll < 0.93 ? 3 : 4;
  });
  const speck = valueNoise(random, n, 64);
  const cell = n / count;
  const data = new Uint8Array(n * n * 4);
  const height = new Float32Array(n * n);
  const rough = new Float32Array(n * n);
  for (let y = 0; y < n; y += 1) {
    const j = Math.floor(y / cell);
    const fy = y - j * cell;
    for (let x = 0; x < n; x += 1) {
      const i = Math.floor(x / cell);
      const fx = x - i * cell;
      const edge = Math.min(fx, cell - fx, fy, cell - fy);
      const k = y * n + x;
      const grout = edge < 1.6;
      const colour = grout ? [0.78, 0.82, 0.82] : palette[pick[j * count + i]];
      const shade = 1 + 0.06 * (speck[k] - 0.5);
      const o = k * 4;
      for (let c = 0; c < 3; c += 1) data[o + c] = byte(colour[c] * shade);
      data[o + 3] = 255;
      height[k] = grout ? -1.5 : Math.min(1, edge / 5) ** 0.5;
      rough[k] = grout ? 1.1 : 0.22;
    }
  }
  return { size: n, map: data, normal: normals(height, n, 1.4), roughness: roughnessData(n, () => 1, (i) => rough[i]) };
}

/**
 * The light a rippled surface throws on the floor under it: a net of bright
 * lines where the ripples focus the sun, the edges of cells between them. The
 * cells are Worley's, on a lattice that wraps, and pushed about by a noise that
 * does, so the net tiles and is not a honeycomb.
 *
 * @returns {{width: number, height: number, data: Uint8Array}}
 */
export function causticTile({ size = 256, cells = 7, seed = 0xca05 } = {}) {
  const n = size;
  const random = seeded(seed);
  const points = Array.from({ length: cells * cells }, () => [random(), random()]);
  const warpX = valueNoise(random, n, 4);
  const warpY = valueNoise(random, n, 4);
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const k = y * n + x;
      const gx = (x / n) * cells + 0.9 * (warpX[k] - 0.5);
      const gy = (y / n) * cells + 0.9 * (warpY[k] - 0.5);
      const ci = Math.floor(gx);
      const cj = Math.floor(gy);
      let d1 = Infinity;
      let d2 = Infinity;
      for (let dj = -1; dj <= 1; dj += 1) {
        for (let di = -1; di <= 1; di += 1) {
          const i = ci + di;
          const j = cj + dj;
          const [px, py] = points[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)];
          const d = Math.hypot(i + px - gx, j + py - gy);
          if (d < d1) [d1, d2] = [d, d1];
          else if (d < d2) d2 = d;
        }
      }
      const line = Math.exp(-(d2 - d1) * 9);
      const v = clamp01(0.85 * line + 0.15 * line * line);
      const o = k * 4;
      data.fill(byte(v), o, o + 3);
      data[o + 3] = 255;
    }
  }
  return { width: n, height: n, data };
}

/**
 * A studio's floor: concrete, power-trowelled and sealed. Clouds a metre
 * across where it cured unevenly, the sweeps of the trowel through them, the
 * aggregate showing as specks, and pinholes. Two metres of it.
 *
 * @returns {{size: number, normal: Uint8Array, roughness: object, map: Uint8Array, mean: number}}
 */
export function concreteTile({ size = 512, seed = 0xc0c0 } = {}) {
  const n = size;
  const random = seeded(seed);
  const cloud = valueNoise(random, n, 3);
  const mottle = valueNoise(random, n, 9);
  const sweep = valueNoise(random, n, 5, 22);
  const fine = valueNoise(random, n, 120);
  const height = new Float32Array(n * n);
  const tone = new Float32Array(n * n);
  const rough = new Float32Array(n * n);
  for (let i = 0; i < n * n; i += 1) {
    const fleck = random();
    const hole = fleck > 0.9975;
    tone[i] =
      1 + 0.12 * (cloud[i] - 0.5) + 0.07 * (mottle[i] - 0.5) + 0.04 * (sweep[i] - 0.5) +
      (hole ? -0.3 : fleck < 0.006 ? 0.1 : fleck < 0.012 ? -0.08 : 0);
    height[i] = 0.5 * fine[i] + 0.6 * sweep[i] - (hole ? 1.5 : 0);
    rough[i] = 0.75 + 0.35 * (mottle[i] - 0.5) + 0.25 * (sweep[i] - 0.5) + (hole ? 0.3 : 0);
  }
  const { map, mean } = grey(n, (i) => 0.88 * tone[i]);
  return { size: n, normal: normals(height, n, 0.8), roughness: roughnessData(n, () => 1, (i) => rough[i]), map, mean };
}

/**
 * A city at night from a hotel's window: the sky going from blue-black to the
 * orange the streetlights turn the haze along the horizon, and across it the
 * blocks of the city, each a darker shape with its windows lit here and there,
 * warm and cool. Soft, the way it is through glass with the room lit.
 *
 * @returns {{width: number, height: number, data: Uint8Array}}
 */
export function nightTile() {
  const w = 256;
  const h = 320;
  const random = seeded(0x417e);
  const data = new Uint8Array(w * h * 4);
  // The skyline, block by block, nearest last so it is drawn over the others.
  const blocks = [];
  for (const [depth, low, high] of [[2, 0.34, 0.6], [1, 0.22, 0.46], [0, 0.1, 0.32]]) {
    let x = -Math.floor(random() * 12);
    while (x < w) {
      const width = 14 + Math.floor(random() * (22 + depth * 6));
      blocks.push({ x, width, top: low + random() * (high - low), depth, seed: Math.floor(random() * 1e6) });
      x += width + Math.floor(random() * 4);
    }
  }
  // A grid of windows, four texels to a floor and three to a bay, some lit -
  // most of them warm, a few the blue of a screen.
  const lit = (block, u, y) => {
    const along = u - block.x;
    if (along % 3 < 1 || y % 4 < 1.5 || along < 1 || along > block.width - 2) return null;
    const roll = seeded(block.seed + Math.floor(along / 3) * 131 + Math.floor(y / 4) * 7919)();
    if (roll > 0.36 - 0.06 * block.depth) return null;
    const bright = 0.7 + 0.3 * (roll / 0.36);
    return (roll < 0.05 ? [0.75, 0.85, 1] : [1, 0.74, 0.4]).map((c) => c * bright);
  };
  for (let y = 0; y < h; y += 1) {
    const v = 1 - y / (h - 1);
    const glow = Math.exp(-v * 3.2);
    const sky = [0.05 + 0.42 * glow, 0.06 + 0.22 * glow, 0.14 + 0.1 * glow];
    for (let x = 0; x < w; x += 1) {
      let colour = sky;
      for (const block of blocks) {
        if (x < block.x || x >= block.x + block.width || v > block.top) continue;
        // The farther blocks paler, in the glow of the haze between.
        const haze = 0.1 + 0.12 * block.depth;
        const wall = sky.map((c, k) => c * haze * 1.6 + [0.02, 0.022, 0.035][k]);
        const window = lit(block, x, y);
        colour = window ? window.map((c, k) => c * (1 - 0.25 * block.depth) + wall[k]) : wall;
      }
      const o = (y * w + x) * 4;
      for (let k = 0; k < 3; k += 1) data[o + k] = byte(colour[k]);
      data[o + 3] = 255;
    }
  }
  // Out of focus: a small box blur.
  const copy = new Float32Array(data);
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1)
      for (let k = 0; k < 3; k += 1) {
        let sum = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy += 1)
          for (let dx = -1; dx <= 1; dx += 1) {
            const yy = y + dy;
            const xx = x + dx;
            if (yy < 0 || yy >= h || xx < 0 || xx >= w) continue;
            sum += copy[(yy * w + xx) * 4 + k];
            count += 1;
          }
        data[(y * w + x) * 4 + k] = Math.round(sum / count);
      }
  return { width: w, height: h, data };
}
