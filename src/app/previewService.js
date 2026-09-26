import { previewKey } from "../core/posePreview.js";

/**
 * One queued worker, bounded cache, subscriptions owned by visible cards.
 *
 * A worker that hangs or crashes costs the scene it was solving, not the whole
 * library: that scene is reported unavailable and remembered as such, and a
 * fresh worker takes the rest of the queue. Only a worker that keeps failing
 * back to back - one that cannot load at all, say - turns previews off.
 */
export function createPreviewService({
  workerFactory = () =>
    new Worker(new URL("../workers/previewWorker.js", import.meta.url), {
      type: "module",
    }),
  capacity = 256,
  maxKeyChars = 1000000,
  timeout = 15000,
  maxRestarts = 3,
} = {}) {
  const cache = new Map(),
    subscribers = new Map(),
    queue = new Map(),
    broken = new Set();
  let worker = null,
    failed = false,
    current = null,
    nextId = 0,
    timer = null,
    keyChars = 0,
    failures = 0;
  const notify = (key, value) =>
    subscribers.get(key)?.forEach((callback) => callback(value));
  const remember = (key, preview) => {
    if (current?.key === key && preview.basis === "refined")
      current.superseded = true;
    if (cache.get(key)?.basis === "refined" && preview.basis !== "refined")
      return;
    if (cache.delete(key)) keyChars -= key.length;
    broken.delete(key);
    cache.set(key, preview);
    keyChars += key.length;
    while (cache.size > capacity || keyChars > maxKeyChars) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
      keyChars -= oldest.length;
    }
    notify(key, { preview });
  };
  function stop() {
    clearTimeout(timer);
    current = null;
    worker?.terminate();
    worker = null;
  }
  function giveUp() {
    failed = true;
    stop();
    queue.clear();
    for (const [key] of subscribers)
      if (!cache.has(key) && !broken.has(key)) notify(key, { error: true });
  }
  function crash() {
    if (failed) return;
    const key = current?.key;
    stop();
    if (key !== undefined) {
      broken.add(key);
      if (broken.size > capacity) broken.delete(broken.values().next().value);
      if (!cache.has(key)) notify(key, { error: true });
    }
    if (++failures > maxRestarts || !start()) return giveUp();
    pump();
  }
  function start() {
    let instance;
    try {
      instance = workerFactory();
    } catch {
      return false;
    }
    worker = instance;
    // A terminated worker can still have an event in flight; only the live
    // one may touch the queue.
    instance.onmessage = ({ data }) => {
      if (instance !== worker) return;
      if (!current || data.id !== current.id || data.key !== current.key)
        return;
      clearTimeout(timer);
      const superseded = current.superseded;
      current = null;
      if (!data.error) failures = 0;
      if (!superseded) {
        if (data.error) notify(data.key, { error: true });
        else remember(data.key, data.preview);
      }
      pump();
    };
    instance.onerror = (event) => {
      event.preventDefault?.();
      if (instance === worker) crash();
    };
    instance.onmessageerror = () => {
      if (instance === worker) crash();
    };
    return true;
  }
  function pump() {
    if (failed || current || !worker) return;
    for (const [key, scene] of queue) {
      queue.delete(key);
      if (!subscribers.get(key)?.size || cache.has(key)) continue;
      current = { id: ++nextId, key };
      try {
        worker.postMessage({ ...current, scene });
      } catch {
        crash();
        return;
      }
      timer = setTimeout(crash, timeout);
      return;
    }
  }
  if (!start()) failed = true;
  return {
    subscribe(scene, callback) {
      const key = previewKey(scene);
      if (!subscribers.has(key)) subscribers.set(key, new Set());
      subscribers.get(key).add(callback);
      if (cache.has(key)) callback({ preview: cache.get(key) });
      else if (failed || broken.has(key)) callback({ error: true });
      else {
        if (current?.key !== key) queue.set(key, structuredClone(scene));
        pump();
      }
      return () => {
        const set = subscribers.get(key);
        set?.delete(callback);
        if (!set?.size) {
          subscribers.delete(key);
          queue.delete(key);
        }
      };
    },
    remember(scene, preview) {
      const key = previewKey(scene);
      queue.delete(key);
      remember(key, preview);
    },
    dispose() {
      failed = true;
      stop();
      queue.clear();
      subscribers.clear();
      cache.clear();
      broken.clear();
      keyChars = 0;
    },
  };
}
