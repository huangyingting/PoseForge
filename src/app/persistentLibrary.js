import { createLibrary, LIBRARY_KEY } from "./libraryStore.js";

export const LIBRARY_DB = "poseforge-library";
export const MIGRATION_KEY = "poseforge.library.indexeddb";

export function openLibraryDatabase(factory = globalThis.indexedDB) {
  return new Promise((resolve, reject) => {
    if (!factory) return reject(new Error("IndexedDB unavailable"));
    const request = factory.open(LIBRARY_DB, 1);
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      reject(
        new Error("Library database is blocked. Close other tabs and reload."),
      );
    }, 4000);
    request.onupgradeneeded = () => request.result.createObjectStore("library");
    request.onerror = () => {
      clearTimeout(timer);
      reject(request.error);
    };
    request.onsuccess = () => {
      clearTimeout(timer);
      const db = request.result;
      if (expired) {
        db.close();
        return;
      }
      db.onversionchange = () => db.close();
      resolve({
        read: () =>
          new Promise((done, fail) => {
            const tx = db.transaction("library", "readonly");
            const get = tx.objectStore("library").get("snapshot");
            tx.oncomplete = () => done(get.result ?? null);
            tx.onabort = tx.onerror = () =>
              fail(tx.error ?? new Error("Library read failed."));
          }),
        write: (revision, text) =>
          new Promise((done, fail) => {
            const tx = db.transaction("library", "readwrite");
            const store = tx.objectStore("library");
            const get = store.get("snapshot");
            let conflict = false;
            const next = { revision: (revision ?? 0) + 1, text };
            get.onsuccess = () => {
              if ((get.result?.revision ?? null) !== revision) {
                conflict = true;
                tx.abort();
              } else {
                try {
                  store.put(next, "snapshot");
                } catch {
                  tx.abort();
                }
              }
            };
            tx.oncomplete = () => done(next);
            tx.onabort = tx.onerror = () =>
              fail(
                new Error(
                  conflict
                    ? "The library changed in another tab. Reload before saving; your current scene is still available."
                    : "Could not save the library. Check browser storage or export a backup.",
                ),
              );
          }),
        close: () => db.close(),
      });
    };
  });
}

function memoryStorage(text) {
  let value = text;
  return {
    getItem: () => value,
    setItem: (_key, next) => {
      value = next;
    },
    removeItem: () => {
      value = null;
    },
  };
}

function unavailable(message, backup = "") {
  const stock = createLibrary(memoryStorage(null));
  const reject = () => {
    throw new Error(message);
  };
  return {
    ...stock,
    error: message,
    mode: "unavailable",
    notice: "",
    raw: () => backup,
    save: reject,
    remove: reject,
    import: reject,
    savePositionOverrides: reject,
    favorite: reject,
    reset: reject,
    export: reject,
    close() {},
  };
}

/** Serial transactions publish new in-memory state only after durable commit. */
export async function createPersistentLibrary(
  legacy,
  { backend, idFactory, open = openLibraryDatabase } = {},
) {
  let database;
  try {
    database = backend ?? (await open());
  } catch {
    let migrated = false;
    try {
      migrated = legacy.getItem(MIGRATION_KEY) === "1";
    } catch {
      /* unavailable */
    }
    const fallback = createLibrary(legacy, idFactory);
    if (!migrated)
      return Object.assign(fallback, {
        mode: "localStorage fallback",
        notice:
          "IndexedDB is unavailable. Using legacy browser storage with a smaller browser-dependent quota.",
        close() {},
      });
    const message =
      "Your migrated library is unavailable. Reload when IndexedDB is accessible; the saved library has not been replaced.";
    return unavailable(message, fallback.raw());
  }
  let snapshot;
  try {
    snapshot = await database.read();
  } catch {
    database.close();
    return unavailable(
      "The library database could not be read. Reload to retry; no saved data was replaced.",
    );
  }
  if (
    snapshot &&
    (!Number.isInteger(snapshot.revision) ||
      snapshot.revision < 1 ||
      typeof snapshot.text !== "string")
  ) {
    database.close();
    return unavailable(
      "The library database has an invalid snapshot. No saved data was replaced.",
      JSON.stringify(snapshot),
    );
  }
  let legacyText = null;
  try {
    legacyText = legacy.getItem(LIBRARY_KEY);
  } catch {
    /* new IDB library can still work */
  }
  let state = createLibrary(
    memoryStorage(snapshot?.text ?? legacyText),
    idFactory,
  );
  const mark = () => {
    try {
      legacy.setItem(MIGRATION_KEY, "1");
    } catch {
      /* backup marker is advisory */
    }
  };
  let notice = "";
  if (!snapshot && legacyText && !state.error) {
    try {
      snapshot = await database.write(null, legacyText);
      mark();
    } catch {
      notice =
        "Legacy library loaded, but migration could not be committed. Your original data is intact. Saving will retry; reload if another tab changed the library.";
    }
  } else if (snapshot) mark();
  let queue = Promise.resolve();
  function mutate(method, args) {
    const task = queue.then(async () => {
      const candidate = createLibrary(memoryStorage(state.raw()), idFactory);
      const result = candidate[method](...args);
      const text =
        candidate.raw() ??
        JSON.stringify({ version: 1, saved: [], favorites: [] });
      const committed = await database.write(snapshot?.revision ?? null, text);
      snapshot = committed;
      state = candidate;
      mark();
      return result;
    });
    queue = task.catch(() => {});
    return task;
  }
  return {
    get error() {
      return state.error;
    },
    mode: "IndexedDB",
    notice,
    close: () => database.close(),
    revision: () => state.revision(),
    all: () => state.all(),
    index: () => state.index(),
    get: (id) => state.get(id),
    resolve: (id) => state.resolve(id),
    saved: () => state.saved(),
    favorites: () => state.favorites(),
    export: () => state.export(),
    raw: () => state.raw(),
    ...Object.fromEntries(
      [
        "save",
        "remove",
        "favorite",
        "import",
        "savePositionOverrides",
        "reset",
      ].map((method) => [method, (...args) => mutate(method, args)]),
    ),
  };
}
