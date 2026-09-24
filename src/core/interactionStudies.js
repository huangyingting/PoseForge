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

export const templateLabel = (template) => TEMPLATE_LABELS[template] ?? TEMPLATE_LABELS.other_pair;

export const isInteractionPreview = (preset) =>
  typeof preset?.id === "string" && preset.id.startsWith("reference.") && Boolean(preset.tags?.includes("interaction"));

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
  const title = `Reference ${entry.sourceId}`;
  const label = templateLabel(record.template === "group_three" ? record.base : record.template);
  const warnings = [INTERACTION_NOTE];
  if (!record.checks.passed) warnings.push(`Some interaction checks are unmet: ${record.checks.failures.join("; ")}.`);
  if (record.note) warnings.push(record.note);
  return {
    id: entry.id,
    title,
    description: `${label}. ${INTERACTION_NOTE}`,
    category: "Interaction studies",
    tags: ["interaction", record.template],
    source: { dataset: "SexPoses", recordId: entry.sourceId, annotationHash: entry.annotationHash },
    scene: { ...structuredClone(record.scene), title },
    inputWarnings: warnings,
  };
}
