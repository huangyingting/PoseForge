/** Bake original gesture compositions from public neutral metadata, offline. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { solveScene } from "../src/core/solver.js";
import { captureSolvedPose } from "../src/core/placement.js";
import { volumesBounds } from "../src/core/body.js";
import { checkScene } from "../src/core/catalog.js";
import { POSTURES } from "../src/core/poseLibrary.js";
import {
  artisticJointSignature,
  checkArtisticStudies,
} from "../src/core/artisticStudies.js";

// Shoulder flexion/abduction and elbow flexion: deliberately separated shapes,
// not seeded angle noise. Both arms are specified, including asymmetries.
const REST = [8, 12, 20],
  OPEN = [5, 75, 20],
  REACH = [65, 15, 25];
const HIGH = [110, 45, 25],
  UP = [150, 10, 20],
  FRAME = [65, 50, 95];
const LOW = [15, 35, 80],
  GATHER = [40, 20, 105];
export const GESTURES = [
  ["rest", "Rest", REST, REST],
  ["open", "Open", OPEN, OPEN],
  ["reach", "Reach", REACH, REACH],
  ["high-v", "High V", HIGH, HIGH],
  ["overhead", "Overhead", UP, UP],
  ["frame", "Frame", FRAME, FRAME],
  ["low-open", "Low open", LOW, LOW],
  ["gather", "Gather", GATHER, GATHER],
  ["left-reach", "Left reach", REACH, REST],
  ["right-reach", "Right reach", REST, REACH],
  ["left-open", "Left open", OPEN, REST],
  ["right-open", "Right open", REST, OPEN],
  ["left-diagonal", "Left diagonal", HIGH, LOW],
  ["right-diagonal", "Right diagonal", LOW, HIGH],
  ["left-high", "Left high", UP, OPEN],
  ["right-high", "Right high", OPEN, UP],
  ["open-reach", "Open reach", OPEN, REACH],
  ["reach-open", "Reach open", REACH, OPEN],
  ["frame-reach", "Frame reach", FRAME, REACH],
  ["reach-frame", "Reach frame", REACH, FRAME],
];
const BASES = {
  Standing: ["standing"],
  Kneeling: ["kneeling", "kneeling_low"],
  Seated: ["seated_floor"],
  Reclining: ["supine", "supine_legs_raised", "side_lying"],
  Crouching: ["squatting"],
  Supported: ["seated_floor", "kneeling"],
  Other: ["standing", "kneeling_low", "supine"],
};
const hash = (value) => createHash("sha256").update(value).digest("hex");
const single = (actor) => ({
  actors: [actor],
  support: { surface: "floor" },
  relationship: { contactMode: "custom" },
  contacts: [],
});

export function buildArtisticStudies(entries, approximateScenes) {
  const poses = new Map(),
    pools = new Map(),
    omitted = [];
  function pool(family, bodyType) {
    const key = `${family}:${bodyType}`;
    if (pools.has(key)) return pools.get(key);
    if (!BASES[family]) throw new Error(`No artistic palette for ${family}.`);
    const result = [];
    for (const posture of BASES[family]) {
      const baseKey = `${bodyType}:${posture}`;
      if (!poses.has(baseKey)) {
        const spec = {
          id: "figure",
          bodyType,
          posture,
          wearing: ["top", "shorts"],
          outfit: "sage",
        };
        const solved = solveScene(single(spec)).actors[0];
        poses.set(baseKey, { ...spec, ...captureSolvedPose(solved) });
      }
      const gestures =
        posture === "side_lying" ? GESTURES.slice(0, 8) : GESTURES;
      for (const [id, name, left, right] of gestures)
        for (const gaze of [-25, 0, 25]) {
          const motif = `${posture}.${id}.${gaze < 0 ? "left" : gaze > 0 ? "right" : "forward"}`;
          const actor = structuredClone(poses.get(baseKey));
          actor.joints.head.rotation = gaze;
          for (const [side, angles] of [
            ["l", left],
            ["r", right],
          ]) {
            // The underneath arm in a side-lying study keeps its authored support.
            if (posture === "side_lying" && side === "r") continue;
            actor.joints[`shoulder_${side}`] = {
              flexion: angles[0],
              abduction: angles[1],
              rotation: 0,
            };
            actor.joints[`elbow_${side}`] = {
              flexion: angles[2],
              abduction: 0,
              rotation: 0,
            };
            actor.joints[`wrist_${side}`] = {
              flexion: 0,
              abduction: 0,
              rotation: 0,
            };
          }
          const scene = checkScene(single(actor));
          const solved = solveScene(scene).actors[0];
          const bounds = volumesBounds(solved.volumes);
          const lift = 0.004 - bounds.min[1];
          if (Math.abs(lift) > 0.12) {
            omitted.push(`${baseKey}.${motif}`);
            continue;
          }
          actor.placement.position[1] += lift;
          const gestureName =
            posture === "side_lying"
              ? `Side ${name === "High V" ? "diagonal" : name.toLowerCase()}`
              : name;
          result.push({ motif, name: gestureName, actor, bounds });
        }
    }
    // Side-supported gestures can collapse to the same free-arm shape.
    const unique = [
      ...new Map(
        result.map((p) => [
          artisticJointSignature(single(p.actor), { includeGaze: true }),
          p,
        ]),
      ).values(),
    ];
    if (!unique.length) throw new Error(`Empty artistic palette: ${key}.`);
    pools.set(key, unique);
    return unique;
  }
  const used = new Set(),
    motifSets = new Set(),
    studies = [];
  for (const entry of entries) {
    const original = approximateScenes.get(entry.previewKey);
    if (!original || original.actors.length !== entry.figures)
      throw new Error("Missing participant template.");
    const choices = entry.postures.map((family, i) =>
      pool(family, original.actors[i].bodyType),
    );
    const size = choices.reduce((n, p) => n * p.length, 1);
    const start = parseInt(hash(entry.sourceId).slice(0, 8), 16) % size;
    let selected;
    for (let attempt = 0; attempt < size; attempt++) {
      let code = (start + attempt) % size;
      const figures = choices
        .map((options) => {
          const p = options[code % options.length];
          code = Math.floor(code / options.length);
          return p;
        })
        // The legacy solver interprets a recumbent primary plus a taller
        // secondary as mounted, even with fixed placements and no contacts.
        // Independent studies put the upright figure first, without changing
        // anyone's joint geometry or counting order as a new composition.
        .sort(
          (a, b) =>
            POSTURES[b.actor.posture].rootHeight -
            POSTURES[a.actor.posture].rootHeight,
        );
      const motifKey = figures
        .map((p) => p.motif.split(".").slice(0, 2).join("."))
        .sort()
        .join("|");
      if (motifSets.has(motifKey)) continue;
      const width =
        figures.reduce((n, p) => n + p.bounds.max[0] - p.bounds.min[0], 0) +
        0.6 * (figures.length - 1);
      let cursor = -width / 2;
      const title = `Study ${entry.sourceId.replace(/^img-/, "")} · ${figures.map((p) => p.name).join(" / ")}`;
      const scene = checkScene({
        ...single(null),
        title,
        description: "",
        actors: figures.map((p, i) => {
          const actor = structuredClone(p.actor);
          actor.placement.position[0] += cursor - p.bounds.min[0];
          cursor += p.bounds.max[0] - p.bounds.min[0] + 0.6;
          return {
            ...actor,
            id: `figure-${i + 1}`,
            label: `Figure ${String.fromCharCode(65 + i)} · ${p.name}`,
            outfit: ["sage", "navy", "clay"][i],
          };
        }),
        relationship: { arrangement: "side_by_side", contactMode: "custom" },
        camera: { view: "three_quarter" },
      });
      const geometry = artisticJointSignature(scene);
      if (used.has(geometry)) continue;
      used.add(geometry);
      motifSets.add(motifKey);
      selected = {
        sourceId: entry.sourceId,
        annotationHash: entry.annotationHash,
        title,
        motifs: figures.map((p) => p.motif),
        scene,
      };
      break;
    }
    if (!selected)
      throw new Error(
        `No distinct artistic composition for ${entry.sourceId}.`,
      );
    studies.push(selected);
  }
  const pack = { format: "poseforge.artistic-studies", version: 1, studies };
  checkArtisticStudies(pack, { records: entries.length }, entries);
  const data = JSON.stringify(pack) + "\n";
  const manifest = {
    format: "poseforge.artistic-manifest",
    version: 1,
    file: "catalog/artistic-studies-v1.json",
    bytes: Buffer.byteLength(data),
    sha256: hash(data),
    records: studies.length,
    participants: studies.reduce((n, p) => n + p.scene.actors.length, 0),
    distinctJointCompositions: used.size,
    jointSignatureBinDegrees: 10,
    distinctIndividualMotifsUsed: new Set(studies.flatMap((p) => p.motifs))
      .size,
    distinctBodyMotifsUsed: new Set(
      studies.flatMap((p) =>
        p.motifs.map((m) => m.split(".").slice(0, 2).join(".")),
      ),
    ).size,
    semantics:
      "Original clothed artistic compositions, not source-matched reconstructions or verified physical poses.",
  };
  return { data, manifest, pack, omitted: [...new Set(omitted)] };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const entries = JSON.parse(
    readFileSync(resolve(root, "public/catalog/sexposes-v1.json")),
  ).entries;
  const scenes = new Map(
    JSON.parse(
      readFileSync(resolve(root, "public/catalog/reference-previews-v1.json")),
    ).scenes.map((p) => [p.key, p.scene]),
  );
  const { data, manifest, omitted } = buildArtisticStudies(entries, scenes);
  for (const [path, text] of [
    [resolve(root, "public", manifest.file), data],
    [
      resolve(root, "src/data/artistic-manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    ],
  ]) {
    if (process.argv.includes("--check")) {
      if (readFileSync(path, "utf8") !== text)
        throw new Error(`Artifact differs: ${path}`);
    } else writeFileSync(path, text);
  }
  console.log(
    JSON.stringify(
      { ...manifest, omittedPaletteCandidates: omitted.length },
      null,
      2,
    ),
  );
}
