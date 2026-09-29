/**
 * A figure's pictures, drawn in code: the skin's fine relief and an eye (see
 * `renderer.js`, which lays them on the figure).
 *
 * Bytes, and nothing but arithmetic on seeded noise, so they are made the same
 * wherever they are made - on a worker, as the page starts (see `tiles.js`),
 * or on the page.
 */

const DETAIL_SIZE = 256;

/**
 * The skin's fine relief - pores, and the crosshatch of creases they sit in -
 * as a tiling normal map, made here rather than shipped.
 *
 * The atlas is a photograph of skin colour, and colour is the half of skin
 * texture that survives flat lighting. The other half is the relief: the
 * surface is not smooth, so a highlight on it is not a smooth gradient but a
 * field of glints broken up by the pits and furrows, and that breaking up is
 * most of what a close look at a shoulder or a cheek reads as "skin" rather
 * than "wax". Without it the skin's specular is a clean sheen and the figure
 * looks lacquered, which is worse than no specular at all.
 *
 * Generated, because it is noise: a pit per cell of a jittered grid for the
 * pores, the edges of a coarser Voronoi pattern for the creases, all tiling
 * exactly so the repeat has no seam. Seeded, so every run draws the same skin.
 *
 * @returns {{size: number, normal: Uint8Array, roughness: Uint8Array}}
 */
export function skinTile() {
  const n = DETAIL_SIZE;
  let seed = 0x5eed5;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const wrap = (i) => ((i % n) + n) % n;
  const height = new Float32Array(n * n);

  // Creases: low along the edges of a Voronoi pattern, where the nearest two
  // seeds are nearly as near as each other.
  const cells = 15;
  const pitch = n / cells;
  const seeds = Array.from({ length: cells * cells }, (_, i) => [((i % cells) + random()) * pitch, (Math.floor(i / cells) + random()) * pitch]);
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
          // The seed's own copy nearest this pixel, so the pattern wraps.
          const ox = sx + (Math.floor(gx / cells) * cells * pitch) - x;
          const oy = sy + (Math.floor(gy / cells) * cells * pitch) - y;
          const d = Math.hypot(ox, oy);
          if (d < f1) [f1, f2] = [d, f1];
          else if (d < f2) f2 = d;
        }
      }
      height[y * n + x] = -0.45 * Math.exp(-((f2 - f1) ** 2) / 3);
    }
  }

  // Pores: a soft pit a texel or two across in each cell of a finer grid.
  const pores = 36;
  const step = n / pores;
  for (let py = 0; py < pores; py += 1) {
    for (let px = 0; px < pores; px += 1) {
      const x0 = (px + 0.15 + 0.7 * random()) * step;
      const y0 = (py + 0.15 + 0.7 * random()) * step;
      const radius = 0.7 + 0.7 * random();
      const depth = 0.5 + 0.5 * random();
      const reach = Math.ceil(radius * 3);
      for (let dy = -reach; dy <= reach; dy += 1) {
        for (let dx = -reach; dx <= reach; dx += 1) {
          const x = Math.round(x0) + dx;
          const y = Math.round(y0) + dy;
          const d2 = (x - x0) ** 2 + (y - y0) ** 2;
          height[wrap(y) * n + wrap(x)] -= depth * Math.exp(-d2 / (2 * radius * radius));
        }
      }
    }
  }

  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const sx = height[y * n + wrap(x + 1)] - height[y * n + wrap(x - 1)];
      const sy = height[wrap(y + 1) * n + x] - height[wrap(y - 1) * n + x];
      const length = Math.hypot(sx, sy, 1);
      const o = (y * n + x) * 4;
      data[o] = Math.round((-sx / length * 0.5 + 0.5) * 255);
      data[o + 1] = Math.round((-sy / length * 0.5 + 0.5) * 255);
      data[o + 2] = Math.round((1 / length * 0.5 + 0.5) * 255);
      data[o + 3] = 255;
    }
  }
  // And how rough each point of it is. A pore and the floor of a crease hold
  // less of the oil film than the skin between them, so they are the matte
  // spots in a highlight; and the whole of it wanders a little from one patch
  // to the next, as skin does from the cheek to the jaw - a single roughness
  // over a body is a single material, and one material is what plastic is.
  const patch = valueNoiseTile(random, n, 4);
  const rough = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i += 1) {
    const value = 0.9 + 0.35 * Math.min(1, -height[i] * 0.9) + 0.16 * (patch[i] - 0.5);
    rough.fill(Math.round(Math.min(1, value / 1.4) * 255), i * 4, i * 4 + 4);
  }
  return { size: n, normal: data, roughness: rough };
}

/**
 * Smooth noise over an `n`-texel square that tiles, `cells` lattice cells
 * across: bicubic-faded value noise, the same kind the room's textures use.
 */
function valueNoiseTile(random, n, cells) {
  const lattice = Float32Array.from({ length: cells * cells }, random);
  const out = new Float32Array(n * n);
  const fade = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < n; y += 1) {
    const gy = (y / n) * cells;
    const j = Math.floor(gy);
    const sy = fade(gy - j);
    for (let x = 0; x < n; x += 1) {
      const gx = (x / n) * cells;
      const i = Math.floor(gx);
      const sx = fade(gx - i);
      const at = (a, b) => lattice[(b % cells) * cells + (a % cells)];
      const top = at(i, j) + (at(i + 1, j) - at(i, j)) * sx;
      const bottom = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * sx;
      out[y * n + x] = top + (bottom - top) * sy;
    }
  }
  return out;
}

/**
 * An eye, seen straight down its gaze: the pupil at the middle, the limbus
 * `limbus` of the tile out from it, and the white beyond. Brown, dark at the
 * rim and amber round the pupil, which is the commonest eye there is and the
 * one every figure here has had.
 *
 * @returns {{size: number, data: Uint8Array}}
 */
export function eyeTile(limbus) {
  const n = 512;
  let seed = 0xe7e;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // Noise round the circle, for fibres and veins: one value per spoke, eased.
  const spokes = (count) => {
    const values = Float32Array.from({ length: count }, random);
    return (angle) => {
      const x = ((angle / (2 * Math.PI)) % 1 + 1) % 1 * count;
      const i = Math.floor(x);
      const t = x - i;
      const s = t * t * (3 - 2 * t);
      return values[i % count] * (1 - s) + values[(i + 1) % count] * s;
    };
  };
  const fine = spokes(260);
  const coarse = spokes(44);
  const wander = spokes(19);
  const veins = spokes(23);
  const pupil = limbus * 0.34;
  // Each texel's colour is mixed in place: an array made for every step of a
  // quarter of a million texels took the best part of a second.
  const colour = new Float64Array(3);
  const iris = new Float64Array(3);
  const set = (c, r, g, b) => {
    c[0] = r;
    c[1] = g;
    c[2] = b;
  };
  const mix = (c, r, g, b, t) => {
    c[0] += (r - c[0]) * t;
    c[1] += (g - c[1]) * t;
    c[2] += (b - c[2]) * t;
  };
  const smooth = (e0, e1, x) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const du = (x + 0.5) / n - 0.5;
      const dv = (y + 0.5) / n - 0.5;
      const r = Math.hypot(du, dv);
      const angle = Math.atan2(dv, du);
      // The white: bone rather than paper, warming and a little pink towards
      // the corners, with a few faint vessels running in from them.
      set(colour, 0.88, 0.85, 0.81);
      mix(colour, 0.86, 0.72, 0.66, 0.55 * smooth(0.22, 0.5, r));
      const vessel = Math.max(0, 1 - Math.abs(veins(angle + wander(r * 9) * 0.25) - 0.5) * 22);
      mix(colour, 0.72, 0.36, 0.32, 0.35 * vessel * smooth(0.24, 0.46, r));
      // The iris, in over a soft rim.
      const inIris = 1 - smooth(limbus - 0.004, limbus + 0.01, r);
      if (inIris > 0) {
        const t = r / limbus;
        const streak = 0.55 * fine(angle + wander(t * 3) * 0.08) + 0.45 * coarse(angle);
        set(iris, 0.36, 0.23, 0.11);
        mix(iris, 0.2, 0.12, 0.065, smooth(0.35, 0.95, t));
        const fibres = 0.72 + 0.56 * streak;
        for (let k = 0; k < 3; k += 1) iris[k] *= fibres;
        // The collarette: a lighter ring a third of the way out.
        mix(iris, 0.45, 0.3, 0.15, 0.35 * Math.exp(-(((t - 0.52) / 0.07) ** 2)));
        // And the dark ring at the rim that tells the eye where the iris ends.
        mix(iris, 0.07, 0.05, 0.04, 0.75 * smooth(0.8, 1, t));
        mix(colour, iris[0], iris[1], iris[2], inIris);
      }
      mix(colour, 0.018, 0.016, 0.015, 1 - smooth(pupil - 0.004, pupil + 0.004, r));
      const o = (y * n + x) * 4;
      for (let k = 0; k < 3; k += 1) data[o + k] = Math.round(Math.min(1, colour[k]) * 255);
      data[o + 3] = 255;
    }
  }
  return { size: n, data };
}
