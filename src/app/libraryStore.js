import {
  BUILTIN_PRESETS,
  checkPreset,
  parseCatalog,
  serializeCatalog,
  MAX_PRESETS,
  MAX_PACK_BYTES,
} from "../core/catalog.js";
import { newId } from "./ids.js";
import {
  isPositionOverride,
  checkPositionOverride,
  positionOverrideId,
  positionOverrideMatches,
  preparePositionOverrides,
} from "../core/positionOverrides.js";
import {
  isBuiltInPosition,
  isPositionVariant,
} from "../core/positionContract.js";
import { migrateLibraryData } from "./libraryMigrations.js";

export const LIBRARY_KEY = "poseforge.library.v1";

// Built-in positions arrive after startup from a separately downloaded pack.
// They are shared stock: every library instance lists them, none stores them.
let positions = [];
let positionIndex = new Map();
let positionSourceIndex = new Map();
const stock = () => (positions.length ? [...BUILTIN_PRESETS, ...positions] : BUILTIN_PRESETS);
const findStock = (id) => positionIndex.get(id) ?? BUILTIN_PRESETS.find((p) => p.id === id);

/** Register the built-in interaction positions (replacing any earlier set). */
export function registerPositions(list) {
  positions = list.map((input) => {
    const position = checkPreset(input);
    if (
      !isBuiltInPosition(position) ||
      !isPositionVariant(position, "interaction") ||
      !position.source
    )
      throw new Error("Registered positions must be source-linked interactions.");
    const inputWarnings = Array.isArray(input.inputWarnings)
      ? input.inputWarnings.filter((message) => typeof message === "string")
      : [];
    return Object.freeze({ ...position, inputWarnings });
  });
  positionIndex = new Map(positions.map((p) => [p.id, p]));
  positionSourceIndex = new Map(
    positions.map((position) => [position.source.recordId, position]),
  );
}
export const positionCount = () => positions.length;
export const DRAFT_KEY = "poseforge.workspace.v1";

/** Commit to storage before replacing memory: a failed write loses no saved work. */
export function createLibrary(storage, idFactory = () => newId()) {
  let saved = [];
  let favorites = [];
  let loadError = "";
  try {
    const text = storage.getItem(LIBRARY_KEY);
    if (text) {
      if (new TextEncoder().encode(text).length > MAX_PACK_BYTES)
        throw new Error("Library too large");
      const data = migrateLibraryData(JSON.parse(text));
      if (data.saved.length > MAX_PRESETS) throw new Error("Library too large");
      saved = data.saved.map(checkPreset);
      saved = saved.map((p) =>
        isPositionOverride(p) ? checkPositionOverride(p) : p,
      );
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
        `Your library is full (${MAX_PRESETS} presets). Export a backup and remove unused presets.`,
      );
    const serialized = JSON.stringify({
      version: 1,
      saved: nextSaved,
      favorites: nextFavorites,
    });
    if (new TextEncoder().encode(serialized).length > MAX_PACK_BYTES)
      throw new Error(
        "Your library exceeds 32 MB. Export a backup and remove unused presets.",
      );
    try {
      storage.setItem(LIBRARY_KEY, serialized);
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
  const materialize = (preset) => {
    if (!isPositionOverride(preset)) return preset;
    const position = positionSourceIndex.get(preset.source.recordId);
    return positionOverrideMatches(preset, position)
      ? checkPositionOverride(preset, position)
      : preset;
  };
  return {
    get error() {
      return loadError;
    },
    all: () => structuredClone([...stock(), ...saved.map(materialize)]),
    get: (id) =>
      structuredClone(
        materialize(findStock(id) ?? saved.find((p) => p.id === id)),
      ),
    resolve(id) {
      const preset = findStock(id) ?? saved.find((p) => p.id === id);
      if (!preset || !isBuiltInPosition(preset) || !preset.source)
        return structuredClone(preset);
      const override = saved.find(
        (candidate) =>
          candidate.id === positionOverrideId(preset.source.recordId),
      );
      return structuredClone(
        positionOverrideMatches(override, preset)
          ? checkPositionOverride(override, preset)
          : preset,
      );
    },
    index() {
      const authoredSources = new Set(
        saved
          .filter(isPositionOverride)
          .filter((override) => {
            const position = positionSourceIndex.get(override.source.recordId);
            return positionOverrideMatches(override, position);
          })
          .map((preset) => preset.source.recordId),
      );
      return [...stock(), ...saved.map(materialize)].map((p) => ({
        id: p.id,
        title: p.title,
        description: p.description,
        category: p.category,
        ...(p.position
          ? {
              position: { ...p.position },
            }
          : {}),
        tags: [...p.tags],
        ...(p.source ? { source: { ...p.source } } : {}),
        scene: { actors: p.scene.actors.map((a) => ({ posture: a.posture })) },
        status:
          p.id.startsWith("builtin.position.") &&
          authoredSources.has(p.source?.recordId)
            ? "authored-3d"
            : isPositionOverride(p)
              ? "authored-3d"
              : p.id.startsWith("builtin.position.")
                ? "interaction-3d"
          : p.id.startsWith("builtin.")
            ? "verified-3d"
            : "needs-adjustment",
      }));
    },
    saved: () => structuredClone(saved.map(materialize)),
    favorites: () => [...favorites],
    save(input, updateId = null) {
      if (updateId && !saved.some((p) => p.id === updateId))
        throw new Error("Only your own saved presets can be updated.");
      const id = updateId ?? freshId(new Set(saved.map((p) => p.id)));
      let next = checkPreset({ ...input, id });
      if (isPositionOverride(next)) {
        const previous = saved.find((p) => p.id === updateId);
        const sourcePosition = positionSourceIndex.get(next.source?.recordId);
        next = checkPositionOverride(
          next,
          sourcePosition ??
            (previous && {
              source: previous.source,
              scene: previous.scene,
            }),
        );
      }
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
      if (!findStock(id) && !saved.some((p) => p.id === id))
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
    savePositionOverrides(inputs, { replace = false } = {}) {
      if (
        !Array.isArray(inputs) ||
        inputs.length < 1 ||
        inputs.length > MAX_PRESETS
      )
        throw new Error(`Provide 1–${MAX_PRESETS} position overrides.`);
      const checked = preparePositionOverrides(inputs, [
        ...saved.filter(isPositionOverride),
        ...positions,
      ]);
      const next = new Map(saved.map((p) => [p.id, p]));
      const written = [];
      let skipped = 0;
      for (const preset of checked) {
        if (next.has(preset.id) && !replace) {
          skipped++;
          continue;
        }
        next.set(preset.id, preset);
        written.push(preset);
      }
      if (written.length) commit([...next.values()]);
      return { written: structuredClone(written), skipped };
    },
    export: () => serializeCatalog(saved.map(materialize)),
    raw: () => storage.getItem(LIBRARY_KEY) ?? "",
    reset() {
      storage.removeItem(LIBRARY_KEY);
      saved = [];
      favorites = [];
      loadError = "";
    },
  };
}
