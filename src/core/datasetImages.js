/**
 * Positions used to be named after their source image in the SexPoses dataset
 * ("img-0042"); they are named after their titles now ("kneeling-missionary").
 * This is the one place the dataset's image IDs remain: the source index is
 * rebuilt from the dataset through it, and links, saved libraries and exports
 * written before the rename find their positions through it.
 */
import images from "../data/dataset-images.json" with { type: "json" };

const POSITIONS = images.positions;
const IMAGES = new Map(Object.entries(POSITIONS).map(([image, id]) => [id, image]));

/** The position a dataset image became; anything else is returned unchanged. */
export const positionOfImage = (value) =>
  typeof value === "string" && Object.hasOwn(POSITIONS, value) ? POSITIONS[value] : value;

/** The dataset image a position came from, or null. */
export const imageOfPosition = (id) => IMAGES.get(id) ?? null;

const PREFIXES = [
  "builtin.position.",
  "builtin.artistic.",
  "builtin.generated.",
  "user.position.sexposes.",
  "user.reference.sexposes.",
  "source.sexposes.",
];

/** A preset or source ID with any old image-named tail renamed. */
export function currentId(id) {
  if (typeof id !== "string") return id;
  const prefix = PREFIXES.find((candidate) => id.startsWith(candidate));
  return prefix ? prefix + positionOfImage(id.slice(prefix.length)) : id;
}

// The catalog's tag limit. A tag that was an image ID becomes the position's
// name where that fits, and is dropped where it does not: the source record
// still names the position, and search reads it from there.
const MAX_TAG_LENGTH = 32;
const renamedTag = (tag) => {
  const name = positionOfImage(tag);
  return name === tag || name.length <= MAX_TAG_LENGTH ? name : null;
};

/** A preset written before the rename, with its ID, source and tags renamed. */
export function currentPreset(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const id = currentId(input.id);
  const source = input.source;
  const recordId = source && typeof source === "object" ? positionOfImage(source.recordId) : undefined;
  const tags = Array.isArray(input.tags)
    ? input.tags.map(renamedTag).filter((tag) => tag !== null)
    : input.tags;
  const renamed =
    id !== input.id ||
    (recordId !== undefined && recordId !== source.recordId) ||
    (Array.isArray(tags) &&
      (tags.length !== input.tags.length || tags.some((tag, i) => tag !== input.tags[i])));
  if (!renamed) return input;
  return {
    ...input,
    id,
    tags,
    ...(recordId !== undefined ? { source: { ...source, recordId } } : {}),
  };
}
