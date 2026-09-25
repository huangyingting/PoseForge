/** Source index with separately loaded generated posture studies. */
import { GENERATED_STUDY_NOTES } from "./generatedStudies.js";
export const CATALOG_PAGE_SIZE = 24;
const FAMILIES = new Set([
  "Standing",
  "Seated",
  "Reclining",
  "Kneeling",
  "Crouching",
  "Supported",
  "Other",
]);
const SURFACES = new Set([
  "Floor",
  "Bed",
  "Seat",
  "Sofa",
  "Table",
  "Wall",
  "Other",
]);
const digest = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

export function checkSourceCatalog(pack, manifest) {
  if (
    pack?.format !== "poseforge.sources" ||
    pack.version !== 1 ||
    !Array.isArray(pack.entries) ||
    pack.entries.length !== manifest.records ||
    pack.entries.length < 1 ||
    pack.entries.length > 20_000
  )
    throw new Error(
      "Source catalog count or format does not match its manifest.",
    );
  const ids = new Set();
  for (const e of pack.entries) {
    if (
      !e ||
      typeof e.sourceId !== "string" ||
      !/^[a-z0-9][a-z0-9_.-]{0,99}$/i.test(e.sourceId ?? "") ||
      e.id !== `source.sexposes.${e.sourceId}` ||
      ids.has(e.id) ||
      !Number.isInteger(e.figures) ||
      e.figures < 1 ||
      e.figures > 4 ||
      !Array.isArray(e.postures) ||
      e.postures.length !== e.figures ||
      e.postures.some((p) => !FAMILIES.has(p)) ||
      e.family !== [...new Set(e.postures)].sort().join(" + ") ||
      !SURFACES.has(e.surface) ||
      !digest(e.generatedKey) ||
      !Array.isArray(e.generatedNotes) ||
      e.generatedNotes.length > 8 ||
      !["separate-participants", "approximate-joints", "assumed-floor"].every(
        (code) => e.generatedNotes.includes(code),
      ) ||
      e.generatedNotes.some(
        (code) => !Object.hasOwn(GENERATED_STUDY_NOTES, code),
      ) ||
      ![e.annotationHash, e.variant, e.imageHash].every(digest) ||
      Object.keys(e).some(
        (k) =>
          ![
            "id",
            "sourceId",
            "figures",
            "family",
            "postures",
            "surface",
            "annotationHash",
            "variant",
            "imageHash",
            "generatedKey",
            "generatedNotes",
          ].includes(k),
      )
    )
      throw new Error("Invalid or duplicate source metadata.");
    ids.add(e.id);
  }
  for (const key of ["figures", "families"]) {
    const field = key === "families" ? "family" : "figures";
    const counts = new Map();
    for (const e of pack.entries)
      counts.set(String(e[field]), (counts.get(String(e[field])) ?? 0) + 1);
    if (
      counts.size !== Object.keys(manifest[key]).length ||
      [...counts].some(([name, count]) => manifest[key][name] !== count)
    )
      throw new Error("Source family counts do not match the manifest.");
  }
  if (
    new Set(pack.entries.map((e) => e.variant)).size !== manifest.variants ||
    new Set(pack.entries.map((e) => e.imageHash)).size !==
      manifest.uniqueImages ||
    new Set(pack.entries.map((e) => e.generatedKey)).size !==
      manifest.generated?.scenes
  )
    throw new Error("Source grouping does not match the manifest.");
  return pack.entries.map((e) =>
    Object.freeze({
      ...e,
      postures: Object.freeze([...e.postures]),
      generatedNotes: Object.freeze([...e.generatedNotes]),
    }),
  );
}

export function querySources(
  entries,
  {
    query = "",
    family = "all",
    group = false,
    favorites = null,
  } = {},
) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = entries.filter(
    (e) =>
      (family === "all" || e.family === family) &&
      (!favorites || favorites.includes(e.id)) &&
      words.every((word) =>
        /^[1-4]$/.test(word)
          ? e.figures === Number(word)
          : `${e.id} ${e.sourceId} ${e.family} ${e.surface} ${e.figures} figures SexPoses`
              .toLowerCase()
              .includes(word),
      ),
  );
  if (!group) return filtered;
  const groups = new Map();
  for (const e of filtered) {
    const key = e.variant;
    if (groups.has(key)) groups.get(key).members.push(e.sourceId);
    else groups.set(key, { ...e, members: [e.sourceId] });
  }
  return [...groups.values()];
}

export function catalogPage(entries, page = 0, pageSize = CATALOG_PAGE_SIZE) {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100)
    throw new Error("Invalid page size.");
  const pages = Math.max(1, Math.ceil(entries.length / pageSize));
  const index = Math.max(
    0,
    Math.min(pages - 1, Number.isFinite(page) ? Math.trunc(page) : 0),
  );
  return {
    entries: entries.slice(index * pageSize, (index + 1) * pageSize),
    page: index,
    pages,
    total: entries.length,
  };
}
