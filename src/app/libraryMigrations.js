import { positionOverrideId } from "../core/positionOverrides.js";
import { currentId, currentPreset } from "../core/datasetImages.js";

const LEGACY_OVERRIDE_PREFIX = "user.reference.sexposes.";
const OVERRIDE_PREFIX = positionOverrideId("");

const migrateId = (id) =>
  typeof id === "string" && id.startsWith(LEGACY_OVERRIDE_PREFIX)
    ? positionOverrideId(id.slice(LEGACY_OVERRIDE_PREFIX.length))
    : id;

/** Convert persisted v1 records to the current position contract. */
export function migrateLibraryData(data) {
  if (
    data?.version !== 1 ||
    !Array.isArray(data.saved) ||
    !Array.isArray(data.favorites)
  )
    throw new Error("Invalid saved library");
  const legacy = (input) =>
    typeof input?.id === "string" && input.id.startsWith(LEGACY_OVERRIDE_PREFIX);
  // A library written across the rename can hold a legacy override and its
  // current-format successor. The successor is the newer record; keeping both
  // would give two presets one ID and make the whole library unreadable.
  // Earlier saves kept the variant of the scene they copied, so a personal copy
  // of a built-in position claimed to be that interaction. Personal presets are
  // studies; only overrides replace a position.
  const copiedVariant = (input) =>
    typeof input?.id === "string" &&
    !input.id.startsWith(OVERRIDE_PREFIX) &&
    input.position &&
    typeof input.position === "object" &&
    input.position.variant !== "studio" &&
    input.position.variant !== undefined;
  const current = new Set(
    data.saved.filter((input) => !legacy(input)).map((input) => input?.id),
  );
  const saved = data.saved
    .filter((input) => !legacy(input) || !current.has(migrateId(input.id)))
    .map((input) =>
      legacy(input)
        ? {
            ...input,
            id: migrateId(input.id),
            position: {
              type: "source_override",
              name: input.title,
              variant: "override",
            },
          }
        : copiedVariant(input)
          ? { ...input, position: { ...input.position, variant: "studio" } }
          : input,
    );
  // Positions were once named after their dataset images. The same reasoning
  // as above applies if a library holds a record under both names: the one
  // already under the new name is the newer.
  const renamed = saved.map(currentPreset);
  const named = new Set(saved.filter((input, i) => renamed[i] === input).map((input) => input?.id));
  return {
    version: 1,
    saved: renamed.filter((input, i) => input === saved[i] || !named.has(input?.id)),
    favorites: [...new Set(data.favorites.map((id) => currentId(migrateId(id))))],
  };
}
