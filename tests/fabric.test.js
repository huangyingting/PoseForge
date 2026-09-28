import assert from "node:assert/strict";
import test from "node:test";
import { foldTile, grainTile, heatherTile, knitTile, reliefTile, ribTile, ROUGHNESS_SPAN, weaveTile } from "../src/render/fabric.js";
import { plasterTile, woodTile } from "../src/render/surfaces.js";
import { LACE_SIZE, lacePattern } from "../src/core/lace.js";

const tiles = () => ({
  knit: knitTile(),
  rib: ribTile(),
  grain: grainTile(),
  fold: foldTile(),
  lace: reliefTile(lacePattern(), LACE_SIZE),
  weave: weaveTile(),
  plaster: plasterTile(),
  wood: woodTile(),
});

/** The largest step between neighbouring texels of a normal map, across the
 *  inside of the tile and across its wrap. */
function steps(normal, n) {
  const at = (x, y, c) => normal[(y * n + x) * 4 + c];
  let inside = 0;
  let wrap = 0;
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const next = (x + 1) % n;
      const step = Math.max(...[0, 1, 2].map((c) => Math.abs(at(next, y, c) - at(x, y, c))));
      if (next === 0) wrap = Math.max(wrap, step);
      else inside = Math.max(inside, step);
    }
  }
  return { inside, wrap };
}

test("every fabric tile is the same cloth every time it is woven", () => {
  const a = tiles();
  const b = tiles();
  for (const name of Object.keys(a)) {
    assert.deepEqual(a[name].normal, b[name].normal, name);
  }
  assert.deepEqual(knitTile().roughness.data, knitTile().roughness.data);
  assert.deepEqual(heatherTile().map, heatherTile().map);
});

test("the fabric tiles repeat without a seam", () => {
  for (const [name, tile] of Object.entries(tiles())) {
    const { inside, wrap } = steps(tile.normal, tile.size);
    // A seam is a step across the wrap that nothing inside the tile matches.
    assert.ok(wrap <= inside, `${name}: ${wrap} across the wrap against ${inside} inside`);
  }
});

test("the fabric normals face out of the cloth and are unit length", () => {
  for (const [name, tile] of Object.entries(tiles())) {
    const { normal, size } = tile;
    assert.equal(normal.length, size * size * 4, name);
    for (let i = 0; i < size * size; i += 97) {
      const [x, y, z] = [0, 1, 2].map((c) => normal[i * 4 + c] / 127.5 - 1);
      assert.ok(z > 0.2, `${name} texel ${i} faces into the cloth`);
      assert.ok(Math.abs(Math.hypot(x, y, z) - 1) < 0.03, `${name} texel ${i} is not unit length`);
    }
  }
});

test("a fabric's averages are what the renderer divides back out", () => {
  for (const tile of [knitTile(), grainTile(), woodTile()]) {
    const { data, cavity, factor } = tile.roughness;
    let c = 0;
    let f = 0;
    for (let i = 0; i < data.length; i += 4) {
      c += data[i] / 255;
      f += (data[i + 1] / 255) * ROUGHNESS_SPAN;
    }
    const n = data.length / 4;
    assert.ok(Math.abs(c / n - cavity) < 1e-9);
    assert.ok(Math.abs(f / n - factor) < 1e-9);
    // Within reach of one - the tile is a variation on the finish's roughness,
    // not a different finish.
    assert.ok(factor > 0.85 && factor < 1.15, `factor ${factor}`);
    assert.ok(cavity > 0.6 && cavity <= 1, `cavity ${cavity}`);
  }
  const { map, mean } = heatherTile();
  assert.ok(mean > 0.9 && mean < 1);
  for (let i = 0; i < map.length; i += 4) assert.ok(map[i] >= 0.85 * 255, "a heather wanders, it does not stain");
  // A grey to multiply a colour by is divided back out by its own mean, which
  // has to be the mean it has.
  for (const [name, tile] of Object.entries({ weave: weaveTile(), plaster: plasterTile(), wood: woodTile() })) {
    let sum = 0;
    for (let i = 0; i < tile.map.length; i += 4) {
      assert.ok(tile.map[i] === tile.map[i + 1] && tile.map[i] === tile.map[i + 2], `${name} is grey`);
      sum += tile.map[i] / 255;
    }
    assert.ok(Math.abs(sum / (tile.map.length / 4) - tile.mean) < 1e-9, name);
    assert.ok(tile.mean > 0.6 && tile.mean <= 1, `${name} mean ${tile.mean}`);
  }
});
