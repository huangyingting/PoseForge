/**
 * Lace, as a picture of where the thread is.
 *
 * One tile of it, made here rather than shipped as an image because both
 * renderers need exactly the same one - the viewport as a texture and the
 * command-line renderer as an array it cuts fragments with - and a pattern that
 * is a function of nothing cannot drift between them.
 *
 * Three layers, which is what a Leavers lace actually is. A diamond net of fine
 * thread, open, so the skin shows through it; flowers worked solid on the net,
 * each with a hole at its heart and a gap round the inner petals so it reads as
 * drawn rather than stamped; and a vine running between them. Everything wraps,
 * so the tile repeats without a seam.
 *
 * The tile is laid on the body's own UV atlas, which runs at about one and a
 * half metres of skin to the unit on every scan here, so `LACE_REPEAT` makes a
 * tile about three centimetres across: a flower the size of a thumbnail and a
 * net under two millimetres to the hole.
 */

export const LACE_SIZE = 256;
export const LACE_REPEAT = 48;

/** Wrapped offset between two tile coordinates. */
const wrap = (d) => d - Math.round(d);

/** How much thread there is at a point of the tile, 0 or 1. */
function thread(u, v) {
  // Two flowers to the tile, on a diagonal lattice, turned against each other.
  for (const [cu, cv, turn] of [[0.25, 0.25, 0], [0.75, 0.75, 0.6]]) {
    const du = wrap(u - cu);
    const dv = wrap(v - cv);
    const d = Math.hypot(du, dv);
    if (d > 0.25) continue;
    const angle = Math.atan2(dv, du) + turn;
    const petal = 0.24 * (0.62 + 0.38 * Math.abs(Math.cos(angle * 2.5)));
    if (d > petal) continue;
    if (d < 0.024) return 0; // the heart, open
    if (Math.abs(d - petal * 0.6) < 0.01) return 0; // the gap round the inner petals
    if (d > petal * 0.6 && Math.abs(Math.sin(angle * 2.5)) < 0.05) return 0; // and between the outer ones
    return 1;
  }

  // The net, everywhere the flowers are not, so their holes are open: two
  // families of diagonal thread, under two millimetres to the hole, which at
  // any distance reads as a veil rather than as holes.
  const a = Math.abs(wrap((u + v) * 12));
  const b = Math.abs(wrap((u - v) * 12));
  if (Math.min(a, b) < 0.1) return 1;

  // The vine between them, and a leaf either side of it halfway along.
  const along = wrap(u + v);
  const across = wrap(u - v - 0.5 - 0.06 * Math.sin(2 * Math.PI * (u + v)));
  if (Math.abs(across) < 0.018) return 1;
  for (const side of [-1, 1]) {
    const lu = along * 2.4;
    const lv = (across - side * 0.05) * 3.6;
    if (lu * lu + lv * lv < 0.04) return 1;
  }
  return 0;
}

let tile = null;

/**
 * The tile, `LACE_SIZE` square, one byte per texel: 255 where there is thread,
 * 0 where there is a hole, and the fraction between at an edge, from a 4x4
 * supersample. Built once.
 */
export function lacePattern() {
  if (tile) return tile;
  tile = new Uint8Array(LACE_SIZE * LACE_SIZE);
  const N = 4;
  for (let y = 0; y < LACE_SIZE; y += 1) {
    for (let x = 0; x < LACE_SIZE; x += 1) {
      let sum = 0;
      for (let j = 0; j < N; j += 1)
        for (let i = 0; i < N; i += 1) sum += thread((x + (i + 0.5) / N) / LACE_SIZE, (y + (j + 0.5) / N) / LACE_SIZE);
      tile[y * LACE_SIZE + x] = Math.round((sum / (N * N)) * 255);
    }
  }
  return tile;
}
