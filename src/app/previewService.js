import { previewKey } from "../core/posePreview.js";

/** One queued worker, bounded cache, subscriptions owned by visible cards. */
export function createPreviewService({
  workerFactory = () =>
    new Worker(new URL("../workers/previewWorker.js", import.meta.url), {
      type: "module",
    }),
  capacity = 256,
  maxKeyChars = 1000000,
  timeout = 15000,
} = {}) {
  const cache = new Map(),
    subscribers = new Map(),
    queue = new Map();
  let worker = null,
    failed = false,
    current = null,
    nextId = 0,
    timer = null,
    keyChars = 0;
  const notify = (key, value) =>
    subscribers.get(key)?.forEach((callback) => callback(value));
  const remember = (key, preview) => {
    if (current?.key === key && preview.basis === "refined")
      current.superseded = true;
    if (cache.get(key)?.basis === "refined" && preview.basis !== "refined")
      return;
    if (cache.delete(key)) keyChars -= key.length;
    cache.set(key, preview);
    keyChars += key.length;
    while (cache.size > capacity || keyChars > maxKeyChars) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
      keyChars -= oldest.length;
    }
    notify(key, { preview });
  };
  function fail() {
    failed = true;
    clearTimeout(timer);
    current = null;
    queue.clear();
    worker?.terminate();
    for (const [key] of subscribers)
      if (!cache.has(key)) notify(key, { error: true });
  }
  function pump() {
    if (failed || current) return;
    for (const [key, scene] of queue) {
      queue.delete(key);
      if (!subscribers.get(key)?.size || cache.has(key)) continue;
      current = { id: ++nextId, key };
      try {
        worker.postMessage({ ...current, scene });
      } catch {
        fail();
        return;
      }
      timer = setTimeout(fail, timeout);
      return;
    }
  }
  try {
    worker = workerFactory();
    worker.onmessage = ({ data }) => {
      if (!current || data.id !== current.id || data.key !== current.key)
        return;
      clearTimeout(timer);
      const superseded = current.superseded;
      current = null;
      if (!superseded) {
        if (data.error) notify(data.key, { error: true });
        else remember(data.key, data.preview);
      }
      pump();
    };
    worker.onerror = (event) => {
      event.preventDefault?.();
      fail();
    };
    worker.onmessageerror = fail;
  } catch {
    failed = true;
  }
  return {
    subscribe(scene, callback) {
      const key = previewKey(scene);
      if (!subscribers.has(key)) subscribers.set(key, new Set());
      subscribers.get(key).add(callback);
      if (cache.has(key)) callback({ preview: cache.get(key) });
      else if (failed) callback({ error: true });
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
      clearTimeout(timer);
      worker?.terminate();
      queue.clear();
      subscribers.clear();
      cache.clear();
      keyChars = 0;
      current = null;
      failed = true;
    },
  };
}
