/** Locally authored, separate posture studies; never a verification badge. */
import { checkPreset, parseCatalog, serializeCatalog } from "./catalog.js";
import {
  Skeleton,
  evaluatePose,
  POSEABLE_BONES,
  CHANNELS,
} from "./skeleton.js";
import { rootFromPlacement, isFixedPlacement } from "./placement.js";
import { buildBodyVolumes, poseVolumes } from "./body.js";

const PREFIX = "user.reference.sexposes.";
export const isReferenceStudy = (preset) =>
  typeof preset?.id === "string" && preset.id.startsWith(PREFIX);
export const referenceStudyId = (sourceId) => `${PREFIX}${sourceId}`;

export function referenceStudyMatches(preset, entry) {
  return Boolean(
    preset &&
    preset.id === referenceStudyId(entry.sourceId) &&
    preset.source?.dataset === "SexPoses" &&
    preset.source.recordId === entry.sourceId &&
    preset.source.annotationHash === entry.annotationHash &&
    preset.scene.actors.length === entry.figures,
  );
}

export function checkReferenceStudy(input, entry) {
  const preset = checkPreset(input);
  if (!preset.source || preset.id !== referenceStudyId(preset.source.recordId))
    throw new Error("A reference study needs its own source-linked study ID.");
  if (entry && !referenceStudyMatches(preset, entry))
    throw new Error(
      `${preset.source.recordId}: source fingerprint or figure count does not match.`,
    );
  const scene = preset.scene;
  if (
    scene.support.surface !== "floor" ||
    scene.relationship.contactMode !== "custom" ||
    scene.contacts.length
  )
    throw new Error(
      "Reference studies need a neutral floor and no partner contacts.",
    );
  const bounds = scene.actors
    .map((actor) => {
      if (!actor.wearing?.includes("top") || !actor.wearing?.includes("shorts"))
        throw new Error("Every reference figure must wear a top and shorts.");
      if (
        actor.jointMode !== "fixed" ||
        !isFixedPlacement(actor.placement) ||
        POSEABLE_BONES.some(({ name }) =>
          CHANNELS.some(
            (channel) => !Number.isFinite(actor.joints?.[name]?.[channel]),
          ),
        )
      )
        throw new Error(
          "Capture the completed layout first: reference studies need fixed placements and complete joint angles.",
        );
      const skeleton = new Skeleton(actor);
      const evaluated = evaluatePose(skeleton, {
        root: rootFromPlacement(actor.placement),
        joints: actor.joints,
      });
      const volumes = poseVolumes(
        skeleton,
        evaluated,
        buildBodyVolumes(skeleton, { bust: actor.bust, anatomy: false }),
      );
      return {
        min: Math.min(
          ...volumes.flatMap((v) => [v.a[0] - v.ra, v.b[0] - v.rb]),
        ),
        max: Math.max(
          ...volumes.flatMap((v) => [v.a[0] + v.ra, v.b[0] + v.rb]),
        ),
      };
    })
    .sort((a, b) => a.min - b.min);
  for (let i = 1; i < bounds.length; i++)
    if (bounds[i].min - bounds[i - 1].max < 0.25)
      throw new Error(
        "Keep figures separate: leave at least 0.25 m between their coarse bounds along X in Placement.",
      );
  // Descriptive provenance is not a parser command.
  preset.scene.description = "";
  return preset;
}

/** Validate every row before a storage transaction may begin. */
export function prepareReferenceStudies(presets, entries) {
  const sources = new Map(entries.map((entry) => [entry.sourceId, entry]));
  const seen = new Set();
  return presets.map((input) => {
    const id = input.source?.recordId;
    const entry = sources.get(id);
    if (!entry)
      throw new Error(`Unknown source reference: ${id ?? "missing source"}.`);
    if (seen.has(id)) throw new Error(`Duplicate source reference: ${id}.`);
    seen.add(id);
    return checkReferenceStudy({ ...input, id: referenceStudyId(id) }, entry);
  });
}

export const parseReferenceStudies = (text, entries) =>
  prepareReferenceStudies(parseCatalog(text), entries);

export function serializeReferenceStudies(presets) {
  return serializeCatalog(
    presets.filter(isReferenceStudy).map((p) => checkReferenceStudy(p)),
  );
}
