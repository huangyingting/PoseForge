/** Original non-graphic compositions, not source-matched reconstructions. */
import { checkPreset } from "./catalog.js";
import {
  checkSeparatePositionScene,
  isPositionVariant,
} from "./positionContract.js";
import { POSEABLE_BONES, CHANNELS } from "./skeleton.js";

export const ARTISTIC_NOTE =
  "Artistic interpretation, not a reconstruction of the source. Clothed figures are separate; pose checks are not physical certification.";
export const isArtisticPosition = (preset) =>
  isPositionVariant(preset, "artistic");

/** Ignore labels, actor order, body choice, colours, placement, camera and gaze. */
export function artisticJointSignature(scene, { includeGaze = false } = {}) {
  return JSON.stringify(
    scene.actors
      .map((actor) =>
        POSEABLE_BONES.filter(
          ({ name }) => includeGaze || !["head", "neck"].includes(name),
        )
          .flatMap(({ name }) =>
            CHANNELS.map((channel) =>
              Math.round(actor.joints[name][channel] / 10),
            ),
          )
          .join(","),
      )
      .sort(),
  );
}

export function checkArtisticStudies(pack, descriptor, entries) {
  if (
    pack?.format !== "poseforge.artistic-studies" ||
    pack.version !== 1 ||
    !Array.isArray(pack.studies) ||
    pack.studies.length !== descriptor.records ||
    pack.studies.length !== entries.length
  )
    throw new Error("Invalid artistic study pack.");
  const sources = new Map(entries.map((entry) => [entry.sourceId, entry]));
  const studies = new Map(),
    geometry = new Set();
  for (const record of pack.studies) {
    const entry = sources.get(record.sourceId);
    if (
      !entry ||
      studies.has(record.sourceId) ||
      record.annotationHash !== entry.annotationHash ||
      !Array.isArray(record.motifs) ||
      record.motifs.length !== entry.figures ||
      record.motifs.some(
        (id) => typeof id !== "string" || !/^[a-z0-9_.-]{1,100}$/.test(id),
      )
    )
      throw new Error("Invalid or duplicate artistic source mapping.");
    const preset = checkPreset(
      {
        id: `builtin.artistic.${entry.sourceId}`,
        title: record.title,
        description: ARTISTIC_NOTE,
        category: "Artistic studies",
        tags: ["artistic", "posture-study"],
        position: {
          type: "artistic_interpretation",
          name: "Artistic interpretation",
          variant: "artistic",
        },
        source: {
          dataset: "SexPoses",
          recordId: entry.sourceId,
          annotationHash: entry.annotationHash,
        },
        scene: record.scene,
      },
    );
    if (preset.scene.actors.length !== entry.figures)
      throw new Error("Artistic position has the wrong participant count.");
    checkSeparatePositionScene(preset.scene);
    const key = artisticJointSignature(preset.scene);
    if (geometry.has(key))
      throw new Error("Artistic studies must have distinct joint geometry.");
    geometry.add(key);
    studies.set(record.sourceId, { ...record, scene: preset.scene });
  }
  return studies;
}

export function artisticPreset(entry, studies, name = null) {
  const record = studies.get(entry.sourceId);
  if (!record)
    throw new Error("Artistic position unavailable for this source.");
  const title = name
    ? `${name} · Artistic interpretation`
    : "Artistic interpretation";
  const preset = checkPreset({
    id: `builtin.artistic.${entry.sourceId}`,
    title,
    description: `${ARTISTIC_NOTE} ${record.title.split(" · ")[1] ?? ""}`,
    category: "Artistic studies",
    tags: ["artistic", "posture-study"],
    position: {
      type: "artistic_interpretation",
      name: "Artistic interpretation",
      variant: "artistic",
    },
    source: {
      dataset: "SexPoses",
      recordId: entry.sourceId,
      annotationHash: entry.annotationHash,
    },
    scene: { ...structuredClone(record.scene), title },
  });
  return { ...preset, inputWarnings: [ARTISTIC_NOTE] };
}
