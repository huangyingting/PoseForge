import assert from "node:assert/strict";
import test from "node:test";
import { createTiles } from "../src/render/tiles.js";
import { TILE_MAKERS } from "../src/render/tileMakers.js";

// The worker's own module, run here, with a structured clone - and the buffers
// handed over, not copied - between it and the page as there is between threads.
const page = { worker: null };
globalThis.self = {
  postMessage: (message, transfer) => page.worker.onmessage({ data: structuredClone(message, { transfer }) }),
};
await import("../src/workers/tileWorker.js");
const receive = globalThis.self.onmessage;
function tileWorker() {
  const worker = {
    posted: [],
    postMessage(message) {
      worker.posted.push(message);
      page.worker = worker;
      receive({ data: structuredClone(message) });
    },
    terminate() {},
  };
  return worker;
}

// A worker that answers when told to.
function fakeWorker() {
  const worker = {
    posted: [],
    terminated: false,
    postMessage: (message) => worker.posted.push(message),
    terminate: () => (worker.terminated = true),
    reply: (index, data) => worker.onmessage({ data: { id: worker.posted[index].id, ...data } }),
  };
  return worker;
}

// The makers, counting what is made on the page.
function counted() {
  const made = [];
  const makers = Object.fromEntries(
    Object.entries(TILE_MAKERS).map(([name, make]) => [name, (...args) => (made.push(name), make(...args))]),
  );
  return { made, makers };
}

const REQUESTS = [
  ["floor", { base: [0.52, 0.38, 0.26], spread: 0.08 }],
  ["rug", [[180, 60, 50], [40, 50, 90], [230, 220, 200]]],
  ["art", [[235, 230, 220], [200, 90, 60], [60, 90, 120]], 235],
  ["weave", { size: 128, threads: 8, slub: 0.5, strength: 3, seed: 0x6b696c6d }],
  ["heather", { streaked: true }],
  ["eye", 0.16],
  ["skin"],
  ["sky"],
  ["towel", [[0.17, 0.48, 0.64], [0.95, 0.93, 0.89], [0.89, 0.64, 0.23]]],
  ["caustic"],
  ["foam"],
  ["night"],
];

test("a tile from the worker is byte for byte the one the page would have made", async () => {
  const { made, makers } = counted();
  const worker = tileWorker();
  const tiles = createTiles({ spawn: () => worker, makers });
  await Promise.all(REQUESTS.map((request) => tiles.prepare(...request)));
  assert.equal(worker.posted.length, REQUESTS.length);
  for (const [name, ...args] of REQUESTS) assert.deepEqual(tiles.take(name, ...args), TILE_MAKERS[name](...args), name);
  assert.deepEqual(made, []);
});

test("one tile is asked for once, however often it is prepared", async () => {
  const worker = fakeWorker();
  const tiles = createTiles({ spawn: () => worker });
  const first = tiles.prepare("glow");
  assert.equal(tiles.prepare("glow"), first);
  tiles.prepare("sky");
  assert.equal(worker.posted.length, 2);
  worker.reply(0, { tile: { width: 1, height: 1, data: new Uint8Array(4) } });
  await first;
  assert.deepEqual(tiles.take("glow"), { width: 1, height: 1, data: new Uint8Array(4) });
});

test("a tile taken before the worker's has come is made on the page, and the worker's is let go", async () => {
  const { made, makers } = counted();
  const worker = fakeWorker();
  const tiles = createTiles({ spawn: () => worker, makers });
  const ready = tiles.prepare("glow");
  assert.deepEqual(tiles.take("glow"), TILE_MAKERS.glow());
  assert.deepEqual(made, ["glow"]);
  worker.reply(0, { tile: "late" });
  await ready;
  // Taken is taken: asked again, it is not sent for, and is made here again.
  await tiles.prepare("glow");
  assert.equal(worker.posted.length, 1);
  assert.notEqual(tiles.take("glow"), "late");
});

test("what a failed worker was making, and whatever is asked for after, is made on the page", async () => {
  const { made, makers } = counted();
  const worker = fakeWorker();
  let spawned = 0;
  const tiles = createTiles({ spawn: () => (spawned++, worker), makers });
  const waiting = [tiles.prepare("sky"), tiles.prepare("glow"), tiles.prepare("rib")];
  worker.reply(0, { error: "out of memory" });
  let prevented = false;
  worker.onerror({ preventDefault: () => (prevented = true) });
  await Promise.all(waiting);
  assert.ok(prevented);
  assert.ok(worker.terminated);
  await tiles.prepare("fold");
  assert.equal(spawned, 1);
  for (const name of ["sky", "glow", "rib", "fold"]) assert.deepEqual(tiles.take(name), TILE_MAKERS[name]());
  assert.deepEqual(made, ["sky", "glow", "rib", "fold"]);
});

test("where there is no worker, a tile is ready at once and made when it is taken", async () => {
  const { made, makers } = counted();
  const tiles = createTiles({ spawn: () => null, makers });
  await tiles.prepare("glow");
  assert.deepEqual(made, []);
  assert.deepEqual(tiles.take("glow"), TILE_MAKERS.glow());
  assert.deepEqual(made, ["glow"]);
  const thrown = createTiles({
    spawn: () => {
      throw new Error("no workers here");
    },
    makers,
  });
  await thrown.prepare("sky");
  assert.deepEqual(thrown.take("sky"), TILE_MAKERS.sky());
});
