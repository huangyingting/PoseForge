/**
 * The viewport's drawn pictures, made off the page's thread.
 *
 * The room's floorboards are a million texels, each worked out from noise, and
 * with the rest of the room's pictures, the skin's pores, an eye and the
 * cloth's weave they come to the best part of two seconds of arithmetic. The
 * page did it in steps while it waited for its first figures, and each step was
 * one it could not answer a click in - the floor's, half a second on its own.
 * A worker makes them instead, as soon as they are asked for, and sends the
 * bytes over; the page only wraps them as textures.
 *
 * `prepare` asks for a tile ahead of its being wanted. `take` hands it over:
 * the worker's, if it has come, or made here and then, as it always was, if it
 * has not or there is no worker to make it - the same bytes either way (see
 * `tileMakers.js`). A tile is taken once; whoever takes it keeps the texture.
 */
import { TILE_MAKERS } from "./tileMakers.js";

const spawnWorker = () =>
  typeof Worker === "undefined"
    ? null
    : new Worker(new URL("../workers/tileWorker.js", import.meta.url), { type: "module" });

export function createTiles({ spawn = spawnWorker, makers = TILE_MAKERS } = {}) {
  // Started when a tile is first asked for; null where there is none to be had.
  let worker;
  const made = new Map();
  const asked = new Map();
  const taken = new Set();
  const tasks = new Map();
  let sent = 0;
  const keyOf = (name, args) => `${name}${JSON.stringify(args)}`;

  // A worker that fails is let go, and what it was making is made here.
  function retire() {
    worker?.terminate();
    worker = null;
    for (const task of tasks.values()) task.settle();
    tasks.clear();
  }

  function start() {
    if (worker !== undefined) return worker;
    try {
      worker = spawn();
    } catch {
      worker = null;
    }
    if (worker) {
      worker.onmessage = ({ data: { id, tile } }) => {
        const task = tasks.get(id);
        if (!task) return;
        tasks.delete(id);
        // One that failed there is made here, and fails here as it always did.
        if (tile && !taken.has(task.key)) made.set(task.key, tile);
        task.settle();
      };
      worker.onerror = (event) => {
        event?.preventDefault?.();
        retire();
      };
      worker.onmessageerror = retire;
    }
    return worker;
  }

  return {
    /** Have the worker make a tile; settled once it can be taken, never rejected. */
    prepare(name, ...args) {
      const key = keyOf(name, args);
      if (taken.has(key)) return Promise.resolve();
      if (!asked.has(key))
        asked.set(
          key,
          new Promise((settle) => {
            if (!start()) return settle();
            const id = (sent += 1);
            tasks.set(id, { key, settle });
            try {
              worker.postMessage({ id, name, args });
            } catch {
              tasks.delete(id);
              settle();
            }
          }),
        );
      return asked.get(key);
    },
    /** The tile `makers[name](...args)` makes, from the worker if it has come. */
    take(name, ...args) {
      const key = keyOf(name, args);
      taken.add(key);
      asked.delete(key);
      const tile = made.get(key);
      made.delete(key);
      return tile ?? makers[name](...args);
    },
  };
}

export const tiles = createTiles();
