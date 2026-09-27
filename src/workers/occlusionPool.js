/**
 * The final pass's occlusion, shared out among helper workers.
 *
 * It is the slowest thing the body worker does once the pose is settled: six
 * field evaluations for each of the two hundred thousand vertices a pair of
 * dressed figures has, seconds of one core while the others sit idle. Each
 * vertex reads nothing but its own position and normal and the scene's
 * volumes, so the vertices can be cut into runs, shaded anywhere, and put back
 * together as exactly the numbers one thread would have written.
 *
 * Helpers are started on first use and kept. A run is handed out only when a
 * helper is free, so a scene given up for a newer one has its remaining runs
 * dropped rather than shaded. Where there are no helpers to be had - no nested
 * workers, or a script that will not load - the runs are shaded here instead.
 */
import { fieldOcclusion } from "../render/meshBuilder.js";

// Vertices in a run: enough to be worth the message, few enough to share out
// evenly and to stop soon after the scene goes stale.
const RUN = 16_384;
// Leave a core for the page and one for this worker's next request.
const HELPERS = Math.max(1, Math.min(6, (globalThis.navigator?.hardwareConcurrency ?? 2) - 2));

let helpers = null;
const idle = [];
const queue = [];

function start() {
  if (helpers) return helpers;
  helpers = [];
  if (typeof Worker === "undefined") return helpers;
  try {
    for (let i = 0; i < HELPERS; i += 1) {
      const helper = new Worker(new URL("./occlusionWorker.js", import.meta.url), { type: "module" });
      helper.onmessage = ({ data }) => {
        const { task } = helper;
        helper.task = null;
        idle.push(helper);
        task.done(data.occlusion);
        pump();
      };
      // A helper that fails is retired, and what it held is shaded here.
      helper.onerror = (event) => {
        event.preventDefault?.();
        const { task } = helper;
        helper.task = null;
        helper.terminate();
        helpers.splice(helpers.indexOf(helper), 1);
        if (task) task.done(shadeHere(task));
        if (!helpers.length) while (queue.length) finish(queue.shift());
        pump();
      };
      helpers.push(helper);
      idle.push(helper);
    }
  } catch {
    for (const helper of helpers) helper.terminate();
    helpers = [];
    idle.length = 0;
  }
  return helpers;
}

/** What a helper is sent for one run: fresh copies, so they can be handed over. */
const message = ({ part, from, to, volumes, step }) => ({
  positions: part.positions.slice(from * 3, to * 3),
  normals: part.normals.slice(from * 3, to * 3),
  volumes,
  step,
});
const shadeHere = (task) => {
  const { positions, normals, volumes, step } = message(task);
  return fieldOcclusion(positions, normals, volumes, step);
};
const finish = (task) => task.done(task.stale() ? null : shadeHere(task));

function pump() {
  while (idle.length && queue.length) {
    const task = queue.shift();
    if (task.stale()) {
      task.done(null);
      continue;
    }
    const helper = idle.pop();
    helper.task = task;
    const sent = message(task);
    helper.postMessage(sent, [sent.positions.buffer, sent.normals.buffer]);
  }
}

/**
 * `fieldOcclusion` for each of `parts` against `volumes`, as one array per
 * part, or null if `stale()` said the scene was given up before it was done.
 */
export async function occludeParts(parts, volumes, step, stale = () => false) {
  // Only what the field reads: the rest of a volume is not worth the copy.
  const field = volumes.map(({ a, b, ra, rb, blend }) => ({ a, b, ra, rb, blend }));
  const out = parts.map((part) => new Float32Array(part.positions.length / 3));
  const runs = [];
  parts.forEach((part, index) => {
    const count = part.positions.length / 3;
    for (let from = 0; from < count; from += RUN) {
      const to = Math.min(count, from + RUN);
      runs.push(
        new Promise((resolve) => {
          const task = {
            part,
            from,
            to,
            volumes: field,
            step,
            stale,
            done: (occlusion) => {
              if (occlusion) out[index].set(occlusion, from);
              resolve(Boolean(occlusion));
            },
          };
          queue.push(task);
        }),
      );
    }
  });
  if (start().length) pump();
  else while (queue.length) finish(queue.shift());
  const shaded = await Promise.all(runs);
  return shaded.every(Boolean) ? out : null;
}
