import {
  BUILTIN_PRESETS,
  checkPreset,
  parseCatalog,
  serializeCatalog,
  MAX_PRESETS,
} from "../core/catalog.js";
import { newId } from "./ids.js";

export const LIBRARY_KEY = "poseforge.library.v1";
export const DRAFT_KEY = "poseforge.workspace.v1";

/** Commit to storage before replacing memory: a failed write loses no saved work. */
export function createLibrary(storage, idFactory = () => newId()) {
  let saved = [];
  let favorites = [];
  let loadError = "";
  try {
    const text = storage.getItem(LIBRARY_KEY);
    if (text) {
      const data = JSON.parse(text);
      if (
        data.version !== 1 ||
        !Array.isArray(data.saved) ||
        !Array.isArray(data.favorites)
      )
        throw new Error("Invalid saved library");
      saved = data.saved.map(checkPreset);
      if (
        saved.length > MAX_PRESETS ||
        saved.some((p) => !p.id.startsWith("user.")) ||
        new Set(saved.map((p) => p.id)).size !== saved.length
      )
        throw new Error("Invalid saved IDs");
      favorites = data.favorites.filter((id) => typeof id === "string");
    }
  } catch {
    saved = [];
    favorites = [];
    loadError =
      "Your saved library could not be read. Export the stored data before replacing it.";
  }
  const commit = (nextSaved, nextFavorites = favorites) => {
    if (loadError) throw new Error(loadError);
    if (nextSaved.length > MAX_PRESETS)
      throw new Error(
        "Your library is full (200 presets). Export a backup and remove unused presets.",
      );
    try {
      storage.setItem(
        LIBRARY_KEY,
        JSON.stringify({
          version: 1,
          saved: nextSaved,
          favorites: nextFavorites,
        }),
      );
    } catch {
      throw new Error(
        "Could not save to this browser. Check available storage or download your scene as JSON.",
      );
    }
    saved = nextSaved;
    favorites = nextFavorites;
  };
  function freshId(used) {
    for (let i = 0; i < 10; i++) {
      const id = idFactory();
      if (typeof id === "string" && id.startsWith("user.") && !used.has(id))
        return id;
    }
    throw new Error("Could not create a unique preset ID.");
  }
  return {
    get error() {
      return loadError;
    },
    all: () => structuredClone([...BUILTIN_PRESETS, ...saved]),
    saved: () => structuredClone(saved),
    favorites: () => [...favorites],
    save(input, updateId = null) {
      if (updateId && !saved.some((p) => p.id === updateId))
        throw new Error("Only your own saved presets can be updated.");
      const id = updateId ?? freshId(new Set(saved.map((p) => p.id)));
      const next = checkPreset({ ...input, id });
      commit(
        updateId
          ? saved.map((p) => (p.id === updateId ? next : p))
          : [...saved, next],
      );
      return structuredClone(next);
    },
    remove(id) {
      if (!saved.some((p) => p.id === id))
        throw new Error("Built-in presets cannot be deleted.");
      commit(
        saved.filter((p) => p.id !== id),
        favorites.filter((f) => f !== id),
      );
    },
    favorite(id) {
      if (![...BUILTIN_PRESETS, ...saved].some((p) => p.id === id))
        throw new Error("Preset not found.");
      commit(
        saved,
        favorites.includes(id)
          ? favorites.filter((f) => f !== id)
          : [...favorites, id],
      );
    },
    import(text) {
      const entries = parseCatalog(text);
      const used = new Set(saved.map((p) => p.id));
      const added = entries.map((entry) => {
        const id = freshId(used);
        used.add(id);
        return checkPreset({ ...entry, id });
      });
      commit([...saved, ...added]);
      return structuredClone(added);
    },
    export: () => serializeCatalog(saved),
    raw: () => storage.getItem(LIBRARY_KEY) ?? "",
    reset() {
      storage.removeItem(LIBRARY_KEY);
      saved = [];
      favorites = [];
      loadError = "";
    },
  };
}
