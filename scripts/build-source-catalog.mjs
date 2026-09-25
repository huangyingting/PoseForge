/** Offline index and separate posture studies. No source images, URLs or prose. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createGeneratedStudyBuilder } from "./generated-posture-scenes.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
export function postureFamily(value = "") {
  const text = String(value).toLowerCase();
  if (/supine|prone|lying|reclin/.test(text)) return "Reclining";
  if (/kneel|all.fours|quadrup/.test(text)) return "Kneeling";
  if (/sit|seat/.test(text)) return "Seated";
  if (/squat|crouch/.test(text)) return "Crouching";
  if (/lift|suspend|carried/.test(text)) return "Supported";
  if (/stand|bent/.test(text)) return "Standing";
  return "Other";
}
function surfaceFamily(value = "") {
  const text = String(value).toLowerCase();
  if (/sofa|couch/.test(text)) return "Sofa";
  if (/chair|seat|bench/.test(text)) return "Seat";
  if (/table|counter/.test(text)) return "Table";
  if (/bed|mattress/.test(text)) return "Bed";
  if (/floor|ground|mat/.test(text)) return "Floor";
  if (/wall/.test(text)) return "Wall";
  return "Other";
}
const digest = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

export function buildSourceCatalog(text) {
  const ids = new Set();
  const buildPreview = createGeneratedStudyBuilder();
  const scenes = new Map();
  const entries = text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      const row = JSON.parse(line),
        a = row.visual_annotation;
      if (
        !a ||
        typeof a !== "object" ||
        typeof a.image_id !== "string" ||
        !/^[a-z0-9][a-z0-9_.-]{0,99}$/i.test(a.image_id ?? "") ||
        row.image_id !== a.image_id ||
        !Array.isArray(a.participants) ||
        a.participants.length < 1 ||
        a.participants.length > 4 ||
        a.participants.some(
          (p) => !p || typeof p !== "object" || typeof p.posture !== "string",
        )
      )
        throw new Error(`Invalid source record on line ${index + 1}.`);
      if (ids.has(a.image_id))
        throw new Error(`Duplicate source ID: ${a.image_id}`);
      ids.add(a.image_id);
      if (!digest(row.source_sha256) || !digest(row.normalized_sha256))
        throw new Error(`Missing image fingerprint on line ${index + 1}.`);
      const postures = a.participants.map((p) => postureFamily(p.posture));
      const preview = buildPreview(a);
      scenes.set(preview.key, preview.scene);
      // Preserve participant order, facing and structured contacts in the hash,
      // not in public metadata. This is annotation equality, not pose equivalence.
      const geometry = {
        participants: a.participants.map(({ id, gender, ...pose }) => pose),
        relationship: a.relationship ?? {},
      };
      return {
        id: `source.sexposes.${a.image_id}`,
        sourceId: a.image_id,
        figures: a.participants.length,
        family: [...new Set(postures)].sort().join(" + "),
        postures,
        surface: surfaceFamily(a.relationship?.support_surface),
        generatedKey: preview.key,
        generatedNotes: preview.notes,
        annotationHash: hash(JSON.stringify(canonical(a))),
        variant: hash(JSON.stringify(canonical(geometry))),
        imageHash: row.normalized_sha256,
      };
    })
    .sort((a, b) => a.sourceId.localeCompare(b.sourceId, "en"));
  if (!entries.length) throw new Error("No source records found.");
  const data =
    JSON.stringify({ format: "poseforge.sources", version: 1, entries }) +
    "\n";
  const previewData =
    JSON.stringify({
      format: "poseforge.generated-studies",
      version: 1,
      scenes: [...scenes]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, scene]) => ({ key, scene })),
    }) + "\n";
  const counts = (key) =>
    Object.fromEntries(
      [...new Set(entries.map((e) => e[key]))]
        .sort()
        .map((value) => [
          value,
          entries.filter((e) => e[key] === value).length,
        ]),
    );
  const manifest = {
    format: "poseforge.source-manifest",
    version: 1,
    dataset: "SexPoses",
    sourceFile: "annotated-pose-dataset/annotations.jsonl",
    sourceSha256: hash(text),
    dataSha256: hash(data),
    bytes: Buffer.byteLength(data),
    records: entries.length,
    variants: new Set(entries.map((e) => e.variant)).size,
    uniqueImages: new Set(entries.map((e) => e.imageHash)).size,
    figures: counts("figures"),
    families: counts("family"),
    file: "catalog/sexposes-v1.json",
    generated: {
      file: "catalog/generated-studies-v1.json",
      bytes: Buffer.byteLength(previewData),
      sha256: hash(previewData),
      scenes: scenes.size,
    },
    semantics:
      "Source metadata plus generated individual posture studies. Generated studies keep participants separate and are not reconstructions of source relationships.",
  };
  return { data, manifest, entries, previewData };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const input = process.argv[2];
  if (!input)
    throw new Error(
      "Usage: node scripts/build-source-catalog.mjs <annotations.jsonl> [--check]",
    );
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const { data, manifest, previewData } = buildSourceCatalog(
    readFileSync(input, "utf8"),
  );
  const outputs = [
    [resolve(root, "public", manifest.file), data],
    [resolve(root, "public", manifest.generated.file), previewData],
    [
      resolve(root, "src/data/source-manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    ],
  ];
  for (const [path, content] of outputs) {
    if (process.argv.includes("--check")) {
      if (readFileSync(path, "utf8") !== content)
        throw new Error(`Generated artifact differs: ${path}`);
    } else {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    }
  }
  console.log(JSON.stringify(manifest, null, 2));
}
