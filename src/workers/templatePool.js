/**
 * Templates shaped on more than one thread.
 *
 * A pair of figures is two bodies to shape, and shaping is the slowest thing
 * between a new scene and its first picture: seconds a body - `featureRelief`,
 * then the clothes - one after the other on the body worker while the other
 * cores wait. Each body reads nothing but its own scan and its own options, so
 * a helper can shape one while the body worker shapes the other, and send back
 * the template the body worker would have built: the same code run elsewhere,
 * so the same numbers.
 *
 * A body stays with whichever thread shaped it first, so the next outfit, hair
 * or expression on it finds the shaped body cached there. A helper's templates
 * arrive as copies, so the last few are kept here as well. Where there are no
 * helpers to be had - no nested workers, or a script that will not load - or
 * one fails, its bodies are shaped here instead, as they always were.
 */
import { humanBodyKey, humanTemplateKey } from "./templateKey.js";

// One thread a body, and a pair is the usual scene; the page, its drawing and
// the body worker keep a core each. A helper started where there is no core
// for it only slows the others down: it has its own scans to parse and its
// own code to warm up.
const HELPERS = Math.max(0, Math.min(2, (globalThis.navigator?.hardwareConcurrency ?? 2) - 3));

const spawnHelper = () =>
  typeof Worker === "undefined" ? null : new Worker(new URL("./templateWorker.js", import.meta.url), { type: "module" });

/**
 * A helper's template made as quick to read as one shaped here.
 *
 * A structured clone gives every array back with its numbers boxed, one heap
 * object each, where the template it was cloned from held them unboxed - and
 * the joints' matrices are read for every vertex of every pose. The same
 * numbers, rebuilt as arrays the engine can store flat; everything else is
 * kept as it came, shared where it was shared.
 */
export function revived(value, seen = new Map()) {
  if (value === null || typeof value !== "object" || ArrayBuffer.isView(value)) return value;
  if (seen.has(value)) return seen.get(value);
  if (Array.isArray(value)) {
    const array = value.map((item) => revived(item, seen));
    seen.set(value, array);
    return array;
  }
  seen.set(value, value);
  if (value instanceof Map) for (const [key, item] of value) value.set(key, revived(item, seen));
  else for (const key of Object.keys(value)) value[key] = revived(value[key], seen);
  return value;
}

/**
 * `local`, a `createTemplateCache`, with each new body sent to whichever thread
 * has least in hand - this one first. `warned(spec, warnings)` hears what a
 * helper's scan loader said about the body it built.
 */
export function createTemplatePool(local, { helpers = HELPERS, spawn = spawnHelper, capacity = 4, warned = () => {} } = {}) {
  const here = { pending: 0 };
  const threads = [here];
  // Body key -> the thread that shaped it.
  const homes = new Map();
  // Template key -> a helper's template, bounded as `createTemplateCache` is.
  const kept = new Map();
  let started = 0;
  let asked = 0;

  const track = (thread, promise) => {
    thread.pending += 1;
    const settle = () => (thread.pending -= 1);
    promise.then(settle, settle);
    return promise;
  };

  // A helper that fails is retired, and what it held is shaped here.
  function retire(helper) {
    if (helper.retired) return;
    helper.retired = true;
    helper.worker.terminate();
    threads.splice(threads.indexOf(helper), 1);
    for (const { spec, resolve } of helper.tasks.values()) resolve(local(spec));
    helper.tasks.clear();
  }

  function start() {
    started += 1;
    let worker = null;
    try {
      worker = spawn();
    } catch {
      worker = null;
    }
    if (!worker) {
      started = helpers;
      return null;
    }
    const helper = { pending: 0, worker, tasks: new Map(), retired: false };
    worker.onmessage = ({ data }) => {
      const task = helper.tasks.get(data.id);
      if (!task) return;
      helper.tasks.delete(data.id);
      if (data.error) task.reject(Object.assign(new Error(data.error.message), { stack: data.error.stack }));
      else {
        warned(task.spec, data.warnings);
        task.resolve(revived(data.template));
      }
    };
    worker.onerror = (event) => {
      event?.preventDefault?.();
      retire(helper);
    };
    worker.onmessageerror = () => retire(helper);
    threads.push(helper);
    return helper;
  }

  // Least in hand, this thread on a tie. A helper is started when every thread
  // already has something, and not before.
  function choose() {
    let best = here;
    for (const thread of threads) if (thread.pending < best.pending) best = thread;
    return best.pending > 0 && started < helpers ? (start() ?? best) : best;
  }

  const remember = (key, value) => {
    if (kept.size >= capacity) kept.delete(kept.keys().next().value);
    kept.set(key, value);
    value.then(
      (result) => {
        if (result === null && kept.get(key) === value) kept.delete(key);
      },
      () => {},
    );
    return value;
  };

  // Started now, so its script has loaded by the time the first scene is solved.
  if (helpers > 0) start();

  return (spec = {}) => {
    const body = humanBodyKey(spec);
    let thread = homes.get(body);
    if (!thread || thread.retired) {
      thread = choose();
      homes.delete(body);
      if (homes.size >= 64) homes.delete(homes.keys().next().value);
      homes.set(body, thread);
    }
    if (thread === here) return track(here, local(spec));
    const key = humanTemplateKey(spec);
    if (kept.has(key)) return kept.get(key);
    // A copy, as the helper gets one: a later edit to the caller's arrays must
    // not reach a body shaped here after all.
    const asking = structuredClone(spec);
    const template = new Promise((resolve, reject) => {
      const id = (asked += 1);
      thread.tasks.set(id, { spec: asking, resolve, reject });
      thread.worker.postMessage({ id, spec: asking });
    });
    return remember(key, track(thread, template));
  };
}
