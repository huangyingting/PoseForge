/** Offline metadata-only projection. No images, URLs or prose are published. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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

export function buildReferenceCatalog(text) {
  const ids = new Set();
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
        throw new Error(`Invalid reference record on line ${index + 1}.`);
      if (ids.has(a.image_id))
        throw new Error(`Duplicate source ID: ${a.image_id}`);
      ids.add(a.image_id);
      if (!digest(row.source_sha256) || !digest(row.normalized_sha256))
        throw new Error(`Missing image fingerprint on line ${index + 1}.`);
      const postures = a.participants.map((p) => postureFamily(p.posture));
      // Preserve participant order, facing and structured contacts in the hash,
      // not in public metadata. This is annotation equality, not pose equivalence.
      const geometry = {
        participants: a.participants.map(({ id, gender, ...pose }) => pose),
        relationship: a.relationship ?? {},
      };
      return {
        id: `reference.sexposes.${a.image_id}`,
        sourceId: a.image_id,
        figures: a.participants.length,
        family: [...new Set(postures)].sort().join(" + "),
        postures,
        surface: surfaceFamily(a.relationship?.support_surface),
        status: "reference-only",
        annotationHash: hash(JSON.stringify(canonical(a))),
        variant: hash(JSON.stringify(canonical(geometry))),
        imageHash: row.normalized_sha256,
      };
    })
    .sort((a, b) => a.sourceId.localeCompare(b.sourceId, "en"));
  if (!entries.length) throw new Error("No reference records found.");
  const data =
    JSON.stringify({ format: "poseforge.references", version: 1, entries }) +
    "\n";
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
    format: "poseforge.reference-manifest",
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
    semantics:
      "Reference metadata only. Variant groups match structured annotations, not verified anatomical positions.",
  };
  return { data, manifest, entries };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const input = process.argv[2];
  if (!input)
    throw new Error(
      "Usage: node scripts/build-reference-catalog.mjs <annotations.jsonl> [--check]",
    );
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const { data, manifest } = buildReferenceCatalog(readFileSync(input, "utf8"));
  const outputs = [
    [resolve(root, "public", manifest.file), data],
    [
      resolve(root, "src/data/reference-manifest.json"),
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
