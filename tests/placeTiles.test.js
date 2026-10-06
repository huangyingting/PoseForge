import assert from "node:assert/strict";
import test from "node:test";
import { causticTile, concreteTile, foamTile, mosaicTile, nightTile, paverTile, sandTile, towelTile, waterTile } from "../src/render/placeTiles.js";

const TOWEL = [[0.17, 0.48, 0.64], [0.95, 0.93, 0.89], [0.89, 0.64, 0.23]];

/** The places' surfaces, each a normal map over a square tile. */
const surfaces = () => ({
  sand: sandTile(),
  water: waterTile(),
  paver: paverTile(),
  mosaic: mosaicTile(),
  concrete: concreteTile(),
});

/** The largest step between neighbouring texels, across the inside of the tile and across its wrap, both ways. */
function steps(data, n) {
  const at = (x, y, c) => data[(y * n + x) * 4 + c];
  let inside = 0;
  let wrap = 0;
  for (let y = 0; y < n; y += 1)
    for (let x = 0; x < n; x += 1)
      for (const [nx, ny] of [[(x + 1) % n, y], [x, (y + 1) % n]]) {
        const step = Math.max(...[0, 1, 2].map((c) => Math.abs(at(nx, ny, c) - at(x, y, c))));
        if (nx === 0 || ny === 0) wrap = Math.max(wrap, step);
        else inside = Math.max(inside, step);
      }
  return { inside, wrap };
}

test("every place's tile is the same every time it is made", () => {
  const [a, b] = [surfaces(), surfaces()];
  for (const name of Object.keys(a)) assert.deepEqual(a[name], b[name], name);
  assert.deepEqual(causticTile(), causticTile());
  assert.deepEqual(foamTile(), foamTile());
  assert.deepEqual(towelTile(TOWEL), towelTile(TOWEL));
  assert.deepEqual(nightTile(), nightTile());
});

test("the places' surfaces and the light under water repeat without a seam", () => {
  for (const [name, tile] of Object.entries(surfaces())) {
    const { inside, wrap } = steps(tile.normal, tile.size);
    assert.ok(wrap <= inside, `${name}: ${wrap} across the wrap against ${inside} inside`);
  }
  const caustic = causticTile();
  const { inside, wrap } = steps(caustic.data, caustic.width);
  assert.ok(wrap <= inside, `caustic: ${wrap} across the wrap against ${inside} inside`);
});

test("the places' normals face out of their surfaces and are unit length", () => {
  for (const [name, { normal, size }] of Object.entries(surfaces())) {
    assert.equal(normal.length, size * size * 4, name);
    for (let i = 0; i < size * size; i += 97) {
      const [x, y, z] = [0, 1, 2].map((c) => normal[i * 4 + c] / 127.5 - 1);
      assert.ok(z > 0.2, `${name} texel ${i} faces into the surface`);
      assert.ok(Math.abs(Math.hypot(x, y, z) - 1) < 0.03, `${name} texel ${i} is not unit length`);
    }
  }
});

test("a towel is striped in its own colours, and only those", () => {
  const { width, height, data } = towelTile(TOWEL);
  assert.equal(data.length, width * height * 4);
  const seen = new Set();
  for (let i = 0; i < width * height; i += 31) {
    const texel = [0, 1, 2].map((c) => data[i * 4 + c] / 255);
    // Each a colour given, under the loops of the terry, a few percent either way.
    const colour = TOWEL.findIndex((given) => given.every((c, k) => Math.abs(texel[k] - c) <= c * 0.09 + 2 / 255));
    assert.ok(colour >= 0, `texel ${i} is ${texel}`);
    seen.add(colour);
  }
  assert.equal(seen.size, 3);
});
