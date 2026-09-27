/**
 * Lace.
 *
 * The tile is the one thing both renderers take on trust from each other - the
 * viewport draws it as a texture and the command-line renderer cuts fragments
 * with it - so what it has to be is checked here once, rather than in two
 * pictures that could both be wrong the same way.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { LACE_SIZE, lacePattern } from "../src/core/lace.js";

const tile = lacePattern();
const at = (x, y) => tile[y * LACE_SIZE + x];

test("the tile is one byte a texel, built once", () => {
  assert.ok(tile instanceof Uint8Array);
  assert.equal(tile.length, LACE_SIZE * LACE_SIZE);
  assert.equal(lacePattern(), tile);
});

test("lace is about half thread and half hole", () => {
  // Much more thread and it is a printed fabric; much less and it is a net,
  // with nothing drawn on it. Either way it has stopped reading as lace.
  let sum = 0;
  let holes = 0;
  let solid = 0;
  for (const value of tile) {
    sum += value;
    if (value === 0) holes += 1;
    if (value === 255) solid += 1;
  }
  const coverage = sum / tile.length / 255;
  assert.ok(coverage > 0.45 && coverage < 0.62, `thread covers ${coverage.toFixed(3)}`);
  assert.ok(holes / tile.length > 0.25, "the skin should show through somewhere");
  assert.ok(solid / tile.length > 0.3, "the flowers should be worked solid");
});

test("the tile repeats without a seam", () => {
  // Across the wrap the change from one texel to the next is no bigger than it
  // is anywhere inside the tile. A pattern that did not wrap would draw a line
  // every three centimetres, and on the scale of a cup that is a grid.
  const step = (a, b) => {
    let columns = 0;
    let rows = 0;
    for (let k = 0; k < LACE_SIZE; k += 1) {
      columns += Math.abs(at(a, k) - at(b, k));
      rows += Math.abs(at(k, a) - at(k, b));
    }
    return [columns / LACE_SIZE, rows / LACE_SIZE];
  };
  let inside = 0;
  for (let k = 0; k + 1 < LACE_SIZE; k += 1) inside += Math.max(...step(k, k + 1));
  inside /= LACE_SIZE - 1;
  const [columns, rows] = step(LACE_SIZE - 1, 0);
  assert.ok(columns < inside, `the wrap across columns steps by ${columns.toFixed(1)} against ${inside.toFixed(1)} inside`);
  assert.ok(rows < inside, `the wrap across rows steps by ${rows.toFixed(1)} against ${inside.toFixed(1)} inside`);
});
