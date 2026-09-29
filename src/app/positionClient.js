/**
 * The position service (see `positionService.js`), run on a worker.
 *
 * The built-in positions are a pack of more than a thousand scenes, each
 * checked on the way in, assembled into a library position and checked again
 * as the library registers it - two seconds of work at start-up, which on the
 * page's thread held back the first picture and every click until it was
 * done. The worker runs the same service on the same packs, in the page's
 * language, and sends back what it made; the page only lists it.
 *
 * Where no worker can be had, or the one there was fails, the service runs
 * here as it always did, and anything the worker held is asked again here.
 */
import { language as pageLanguage } from "../i18n/index.js";
import { checkPositions } from "./libraryStore.js";
import { createPositionService } from "./positionService.js";

const spawnWorker = () =>
  typeof Worker === "undefined"
    ? null
    : new Worker(new URL("../workers/positionWorker.js", import.meta.url), { type: "module" });

// Where the packs are, as the page sees it: a worker would read a relative
// base against its own script.
const pageBase = () =>
  String(new URL(import.meta.env?.BASE_URL ?? "/", globalThis.document?.baseURI ?? globalThis.location?.href));

export function createPositionClient({
  spawn = spawnWorker,
  local = () => createPositionService(),
  language = pageLanguage,
  base,
} = {}) {
  let worker = null;
  let here = null;
  const tasks = new Map();
  let asked = 0;
  const fallback = () => (here ??= local());

  function retire() {
    if (!worker) return;
    worker.terminate();
    worker = null;
    for (const task of tasks.values()) task.again();
    tasks.clear();
  }

  try {
    worker = spawn();
  } catch {
    worker = null;
  }
  if (worker) {
    worker.onmessage = ({ data }) => {
      const task = tasks.get(data.id);
      if (!task) return;
      tasks.delete(data.id);
      if ("error" in data) task.reject(new Error(data.error));
      else task.resolve(data.value);
    };
    worker.onerror = (event) => {
      event?.preventDefault?.();
      retire();
    };
    worker.onmessageerror = retire;
  }

  const call = (method, args, locally = () => fallback()[method](...args)) => {
    if (!worker) return locally();
    return new Promise((resolve, reject) => {
      const id = (asked += 1);
      const again = () => locally().then(resolve, reject);
      tasks.set(id, { resolve, reject, again });
      try {
        worker.postMessage({ id, base: (base ??= pageBase()), language, method, args });
      } catch {
        tasks.delete(id);
        again();
      }
    });
  };

  // Shared, as the service's own index is, and asked again after a failure.
  let sources = null;
  return {
    sources: () =>
      (sources ??= call("sources", []).catch((error) => {
        sources = null;
        throw error;
      })),
    source: (sourceId) => call("source", [sourceId]),
    variant: (entry, variant, name) => call("variant", [entry, variant, name]),
    /** The positions as the library registers them, already checked (see `checkPositions`). */
    positions: () => call("positions", [], () => fallback().positions().then(checkPositions)),
  };
}
