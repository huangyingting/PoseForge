import { positionOverrideId } from "../core/positionOverrides.js";

const LEGACY_OVERRIDE_PREFIX = "user.reference.sexposes.";

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
  return {
    version: 1,
    saved: data.saved.map((input) =>
      typeof input?.id === "string" &&
      input.id.startsWith(LEGACY_OVERRIDE_PREFIX)
        ? {
            ...input,
            id: migrateId(input.id),
            position: {
              type: "source_override",
              name: input.title,
              variant: "override",
            },
          }
        : input,
    ),
    favorites: data.favorites.map(migrateId),
  };
}
