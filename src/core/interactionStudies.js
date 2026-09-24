/** Composed 3D interaction studies: approximate, clothed, source-linked. */
import { checkScene } from "./catalog.js";
import { isFixedPlacement } from "./placement.js";
import { POSEABLE_BONES, CHANNELS } from "./skeleton.js";

export const INTERACTION_SEMANTICS =
  "Approximate clothed 3D interactions composed from a visual classification of each source image into an interaction template, with fixed placements, joints and declared contacts. Not measured reconstructions or verified physical poses.";

export const INTERACTION_NOTE =
  "Approximate 3D interaction composed from an interaction template, not a measured reconstruction of the source. Figures are clothed; contact and balance checks are not physical certification.";

export const TEMPLATE_LABELS = {
  missionary: "Face to face, one partner above",
  prone_on_top: "Lying flat, chest to chest",
  kneeling_missionary: "Face to face, kneeling between the legs",
  edge_missionary: "At the edge, partner in front between the legs",
  edge_seated_facing: "Seated on an edge, partner in front between the legs",
  cowgirl: "Astride, facing the partner lying down",
  squat_cowgirl: "Squatting astride, facing the partner",
  reverse_cowgirl: "Astride, facing the partner's feet",
  sixty_nine: "Head to toe",
  side_facing: "Side by side, face to face",
  spooning: "Side by side, one behind the other",
  scissors: "Crossed at an angle, legs interlaced",
  doggy: "On hands and knees, partner kneeling behind",
  doggy_low: "Chest lowered, partner kneeling behind",
  kneeling_rear_upright: "Both kneeling upright, chest to back",
  standing_rear: "Both standing, one behind",
  standing_bent_over: "Bent forward, partner standing behind",
  furniture_rear: "Leaning over furniture, partner behind",
  prone_rear: "Lying face down, partner over from behind",
  wheelbarrow: "Hands on the floor, legs held up",
  lap_facing: "Astride the seated partner, face to face",
  lap_reverse: "On the seated partner's lap, facing away",
  reclined_facing: "Both reclined on their hands, face to face",
  standing_facing: "Standing face to face",
  standing_carry: "Lifted and carried, face to face",
  supported_inversion: "Hips raised high, partner at the hips",
  oral_on_a: "Head at the reclining partner's hips",
  oral_on_b_kneeling: "Kneeling at the standing or seated partner's hips",
  oral_on_b_lying: "Head at the hips of the partner lying down",
  facesitting: "Kneeling astride the partner's head",
  other_pair: "Close pair",
  solo: "Single figure",
};

/** Short position names for the library, one per template. */
export const POSITION_NAMES = {
  missionary: "Missionary",
  prone_on_top: "Lying on top",
  kneeling_missionary: "Kneeling missionary",
  edge_missionary: "Edge missionary",
  edge_seated_facing: "Seated edge, face to face",
  cowgirl: "Cowgirl",
  squat_cowgirl: "Squatting cowgirl",
  reverse_cowgirl: "Reverse cowgirl",
  sixty_nine: "Sixty-nine",
  side_facing: "Side by side, facing",
  spooning: "Spooning",
  scissors: "Scissors",
  doggy: "Doggy style",
  doggy_low: "Chest-down doggy",
  kneeling_rear_upright: "Kneeling from behind",
  standing_rear: "Standing from behind",
  standing_bent_over: "Standing bent over",
  furniture_rear: "Bent over furniture",
  prone_rear: "Lying face down from behind",
  wheelbarrow: "Wheelbarrow",
  lap_facing: "Lap, face to face",
  lap_reverse: "Reverse lap",
  reclined_facing: "Reclined, face to face",
  standing_facing: "Standing, face to face",
  standing_carry: "Standing carry",
  supported_inversion: "Hips raised",
  oral_on_a: "Oral, partner reclining",
  oral_on_b_kneeling: "Oral, kneeling",
  oral_on_b_lying: "Oral, partner lying",
  facesitting: "Facesitting",
  other_pair: "Close pair",
  solo: "Solo",
  group_three: "Three people",
};

/** Broad browsing groups; each contains several related named positions. */
export const POSITION_CATEGORIES = {
  missionary: "Face-to-face",
  prone_on_top: "Partner on top",
  kneeling_missionary: "Face-to-face",
  edge_missionary: "Face-to-face",
  edge_seated_facing: "Seated & lap",
  cowgirl: "Partner on top",
  squat_cowgirl: "Partner on top",
  reverse_cowgirl: "Partner on top",
  sixty_nine: "Oral",
  side_facing: "Side-by-side",
  spooning: "Side-by-side",
  scissors: "Side-by-side",
  doggy: "From behind",
  doggy_low: "From behind",
  kneeling_rear_upright: "From behind",
  standing_rear: "From behind",
  standing_bent_over: "From behind",
  furniture_rear: "From behind",
  prone_rear: "From behind",
  wheelbarrow: "Acrobatic & supported",
  lap_facing: "Seated & lap",
  lap_reverse: "Seated & lap",
  reclined_facing: "Face-to-face",
  standing_facing: "Standing & carried",
  standing_carry: "Standing & carried",
  supported_inversion: "Acrobatic & supported",
  oral_on_a: "Oral",
  oral_on_b_kneeling: "Oral",
  oral_on_b_lying: "Oral",
  facesitting: "Oral",
  other_pair: "Other interactions",
  solo: "Solo & group",
  group_three: "Solo & group",
};

export const POSITION_PREFIX = "builtin.position.";
export const isPosition = (preset) => typeof preset?.id === "string" && preset.id.startsWith(POSITION_PREFIX);

const SURFACE_LABELS = {
  floor: "Floor",
  bed: "Bed",
  sofa: "Sofa",
  chair: "Chair",
  table: "Table",
  bench: "Bench",
};
const POSTURE_LABELS = {
  standing: "standing",
  seated: "seated",
  kneeling: "kneeling",
  reclining: "reclining",
  crouching: "crouching",
  supported: "supported",
};

/**
 * Every interaction study as a playable, source-linked library position.
 * Reference metadata is merged into the preset so the app has one catalog.
 */
export function interactionPositions(studies, entries = []) {
  const references = new Map(entries.map((entry) => [entry.sourceId, entry]));
  const out = [];
  for (const record of studies.values()) {
    const type =
      record.template === "group_three" ? "group_three" : record.template;
    const name = POSITION_NAMES[type] ?? POSITION_NAMES.other_pair;
    const category =
      POSITION_CATEGORIES[type] ?? POSITION_CATEGORIES.other_pair;
    const reference = references.get(record.sourceId);
    const surface =
      reference?.surface ??
      SURFACE_LABELS[record.surface] ??
      record.surface.replace(/^\w/, (letter) => letter.toUpperCase());
    const postures = reference?.postures?.map(
      (posture) => POSTURE_LABELS[posture.toLowerCase()] ?? posture.toLowerCase(),
    );
    const figures = reference?.figures ?? record.scene.actors.length;
    const postureText = postures?.length
      ? [...new Set(postures)].join(" and ")
      : record.scene.actors
          .map((actor) => POSTURE_LABELS[actor.posture] ?? actor.posture)
          .join(" and ");
    const title = `${name} · ${surface} · ${record.sourceId.toUpperCase()}`;
    const label = templateLabel(
      record.template === "group_three" ? record.base : record.template,
    );
    const warnings = [INTERACTION_NOTE];
    if (!record.checks.passed) warnings.push(`Some interaction checks are unmet: ${record.checks.failures.join("; ")}.`);
    if (record.note) warnings.push(record.note);
    out.push({
      id: `${POSITION_PREFIX}${record.sourceId}`,
      title,
      description: `${name}: ${label}. ${figures} clothed ${figures === 1 ? "figure" : "figures"} in ${postureText} positions on ${surface.toLowerCase()}. Approximate template-based 3D interpretation of source ${record.sourceId}.`,
      category,
      positionName: name,
      positionCategory: category,
      surface,
      figures,
      reference: reference
        ? {
            id: reference.id,
            sourceId: reference.sourceId,
            figures: reference.figures,
            family: reference.family,
            postures: [...reference.postures],
            surface: reference.surface,
            variant: reference.variant,
            imageHash: reference.imageHash,
          }
        : null,
      tags: [
        "interaction",
        "position",
        record.template,
        record.surface,
        record.sourceId,
        category,
        name,
      ],
      source: { dataset: "SexPoses", recordId: record.sourceId, annotationHash: record.annotationHash },
      scene: { ...structuredClone(record.scene), title },
      inputWarnings: warnings,
    });
  }
  return out;
}

export const templateLabel = (template) => TEMPLATE_LABELS[template] ?? TEMPLATE_LABELS.other_pair;

export const isInteractionPreview = (preset) =>
  typeof preset?.id === "string" &&
  (preset.id.startsWith("reference.") || preset.id.startsWith("builtin.position.")) &&
  Boolean(preset.tags?.includes("interaction"));

const TEMPLATE_IDS = new Set([...Object.keys(TEMPLATE_LABELS), "group_three"]);

export function checkInteractionStudies(pack, descriptor, entries) {
  if (
    pack?.format !== "poseforge.interaction-studies" ||
    pack.version !== 1 ||
    !Array.isArray(pack.studies) ||
    pack.studies.length !== descriptor.records ||
    pack.studies.length !== entries.length
  )
    throw new Error("Invalid interaction study pack.");
  const sources = new Map(entries.map((entry) => [entry.sourceId, entry]));
  const studies = new Map();
  for (const record of pack.studies) {
    const entry = sources.get(record?.sourceId);
    if (
      !entry ||
      studies.has(record.sourceId) ||
      record.annotationHash !== entry.annotationHash ||
      !TEMPLATE_IDS.has(record.template) ||
      (record.template === "group_three" && !TEMPLATE_LABELS[record.base]) ||
      typeof record.title !== "string" ||
      record.title.length > 80 ||
      typeof record.checks?.passed !== "boolean" ||
      !Array.isArray(record.checks.failures) ||
      record.checks.failures.some((f) => typeof f !== "string" || f.length > 120)
    )
      throw new Error("Invalid or duplicate interaction source mapping.");
    const scene = checkScene(record.scene);
    if (scene.actors.length < 1 || scene.actors.length > 3) throw new Error("Interaction studies have one to three participants.");
    if (scene.actors.length > 1 && !scene.contacts?.some((c) => c.fromActor !== c.toActor))
      throw new Error("Interaction studies need a contact between participants.");
    for (const actor of scene.actors) {
      if (!actor.wearing?.includes("top") || !actor.wearing?.includes("shorts"))
        throw new Error("Every interaction figure must wear a top and shorts.");
      if (
        actor.jointMode !== "fixed" ||
        !isFixedPlacement(actor.placement) ||
        POSEABLE_BONES.some(({ name }) => CHANNELS.some((channel) => !Number.isFinite(actor.joints?.[name]?.[channel])))
      )
        throw new Error("Interaction studies need fixed placements and complete joint angles.");
    }
    studies.set(record.sourceId, { ...record, scene });
  }
  return studies;
}

export function interactionPreset(entry, studies) {
  const record = studies.get(entry.sourceId);
  if (!record) throw new Error("Interaction study unavailable for this reference.");
  return {
    ...interactionPositions(new Map([[entry.sourceId, record]]), [entry])[0],
    id: entry.id,
  };
}
