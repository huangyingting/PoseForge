/**
 * The room's materials, as the surfaces they are: painted plaster and wood.
 *
 * The same failing as the cloth's (see `fabric.js`), in the room: a wall that
 * is one flat colour from floor to ceiling is a picture of a wall, and a
 * nightstand that is one smooth brown is a box. Paint on plaster has the
 * roller's stipple in it and is never quite one colour across a wall; wood has
 * a figure that runs along the board, and pores that run with it and hold the
 * light differently from the face between them.
 *
 * Tiles in the same conventions as the cloth's: square RGBA bytes that tile
 * exactly, seeded, normals in tangent space, roughness in green over
 * `ROUGHNESS_SPAN`, and a grey `map` to multiply the colour by with its `mean`
 * to divide back out, so a surface seen from across the room is the colour it
 * was given. Wood's grain runs along `u`.
 */

import { normals, roughnessData, seeded, valueNoise } from "./fabric.js";

const byte = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255);

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
 * Emulsion on plaster: the roller's stipple, fine and even, over the plaster's
 * own long undulation, and the paint a shade lighter or darker in patches a
 * hand across - how a wall looks where the light rakes it, and why it does not
 * look like a sheet of card.
 *
 * @returns {{size: number, normal: Uint8Array, map: Uint8Array, mean: number}}
 */
export function plasterTile({ size = 256, seed = 0x706c6173 } = {}) {
  const n = size;
  const random = seeded(seed);
  const stipple = valueNoise(random, n, 64);
  const fine = valueNoise(random, n, 128);
  const swell = valueNoise(random, n, 4);
  const patch = valueNoise(random, n, 3);
  const patchFine = valueNoise(random, n, 8);
  const height = new Float32Array(n * n);
  for (let i = 0; i < n * n; i += 1) {
    // A stipple is peaks more than pits: the roller pulls the paint up.
    const s = 0.65 * stipple[i] + 0.35 * fine[i];
    height[i] = 0.5 * s * s + 1.6 * swell[i];
  }
  const { map, mean } = grey(n, (i) => 0.97 + 0.035 * (patch[i] - 0.5) + 0.02 * (patchFine[i] - 0.5));
  return { size: n, normal: normals(height, n, 1.1), map, mean };
}

/**
 * Wood: the figure of a flat-sawn board, its growth rings drawn out along the
 * board into long flames that wander, fine streaks with them, and the pores -
 * short dark dashes along the grain, sunk into the face and duller than it.
 *
 * @returns {{size: number, normal: Uint8Array, roughness: {data: Uint8Array, cavity: number, factor: number}, map: Uint8Array, mean: number}}
 */
export function woodTile({ size = 512, seed = 0x776f6f64 } = {}) {
  const n = size;
  const random = seeded(seed);
  const wander = valueNoise(random, n, 2, 3);
  const bend = valueNoise(random, n, 4, 7);
  const streak = valueNoise(random, n, 3, 90);
  const pore = valueNoise(random, n, 40, 220);
  const figure = new Float32Array(n * n);
  const pores = new Float32Array(n * n);
  const height = new Float32Array(n * n);
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const i = y * n + x;
      // Rings across the board, pushed about along it: seven to a tile, so
      // the whole number keeps the tile's edges meeting.
      const ring = Math.sin(((y / n) * 7 + 1.4 * wander[i] + 0.35 * bend[i]) * Math.PI * 2);
      const late = Math.max(0, ring) ** 3;
      figure[i] = 0.7 * late + 0.3 * streak[i];
      pores[i] = Math.max(0, (pore[i] - 0.72) / 0.28) * (0.6 + 0.4 * late);
      height[i] = -1.2 * pores[i] - 0.15 * late;
    }
  }
  const { map, mean } = grey(n, (i) => 1 - 0.16 * figure[i] - 0.1 * pores[i]);
  const roughness = roughnessData(n, () => 1, (i) => 0.92 + 0.14 * figure[i] + 0.35 * pores[i]);
  return { size: n, normal: normals(height, n, 0.9), roughness, map, mean };
}
