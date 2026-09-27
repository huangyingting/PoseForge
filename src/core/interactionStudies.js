/** Composed 3D interaction studies: approximate, clothed, source-linked. */
import { checkPreset, checkScene } from "./catalog.js";
import {
  checkFixedPositionScene,
  isPositionVariant,
  positionId,
} from "./positionContract.js";

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
  supine_stack: "Both face up, one lying back on the other",
  rear_oral: "Head at the partner's hips from behind",
  edge_head_oral: "Head over the edge, partner standing at the head",
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
  supine_stack: "Stacked, both face up",
  rear_oral: "Oral from behind",
  edge_head_oral: "Oral, head over the edge",
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
  supine_stack: "Partner on top",
  rear_oral: "Oral",
  edge_head_oral: "Oral",
  other_pair: "Other interactions",
  solo: "Solo & group",
  group_three: "Solo & group",
};

const SURFACE_LABELS = {
  floor: "Floor",
  bed: "Bed",
  sofa: "Sofa",
  chair: "Chair",
  table: "Table",
  bench: "Bench",
  ball: "Exercise ball",
  wedge: "Wedge cushion",
  ramp: "Ramp cushion",
  car_seat: "Car seat",
  ottoman: "Ottoman",
  wall: "Wall",
  table_chair: "Table and chair",
  swing: "Sex swing",
  swing_low: "Sex swing",
  sling: "Sling",
  pole: "Pole",
  stairs: "Stairs",
  pillows: "Pillow stack",
  pillow: "Pillow",
  spreader_bar: "Spreader bar",
};
// Props the source annotations have no word for: the scene's own name is more specific.
const SPECIFIC_SURFACES = new Set(["ball", "wedge", "ramp", "car_seat", "ottoman", "wall", "table_chair", "swing", "swing_low", "sling", "pole", "stairs", "pillows", "pillow", "spreader_bar"]);
// How each support reads inside a sentence; the labels above are headings.
const SURFACE_PHRASES = {
  Floor: "on the floor",
  Bed: "on a bed",
  Sofa: "on a sofa",
  Seat: "on a seat",
  Chair: "on a chair",
  Table: "on a table",
  Bench: "on a bench",
  "Exercise ball": "on an exercise ball",
  "Wedge cushion": "on a wedge cushion",
  "Ramp cushion": "on a ramp cushion",
  "Car seat": "on a car's back seat",
  Ottoman: "at an ottoman",
  "Table and chair": "at a table and chair",
  Wall: "against a wall",
  "Sex swing": "in a sex swing",
  Sling: "in a sling",
  Pole: "at a pole",
  Stairs: "on a stair",
  "Pillow stack": "over a stack of pillows",
  Pillow: "on a pillow",
  "Spreader bar": "under a spreader bar",
  Other: "on another support",
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
 * Source metadata is merged into the preset so the app has one catalog.
 */
export function interactionPositions(studies, entries = []) {
  const sources = new Map(entries.map((entry) => [entry.sourceId, entry]));
  const out = [];
  for (const record of studies.values()) {
    const type =
      record.scene.actors.length > 3
        ? `group_${record.scene.actors.length}`
        : record.template === "group_three"
          ? "group_three"
          : record.template;
    const name =
      POSITION_NAMES[type] ??
      (record.scene.actors.length > 3
        ? `${record.scene.actors.length}-person interaction`
        : POSITION_NAMES.other_pair);
    const category =
      record.scene.actors.length > 2
        ? POSITION_CATEGORIES.group_three
        : POSITION_CATEGORIES[type] ?? POSITION_CATEGORIES.other_pair;
    const sourceEntry = sources.get(record.sourceId);
    const surface =
      (SPECIFIC_SURFACES.has(record.surface) ? SURFACE_LABELS[record.surface] : null) ??
      sourceEntry?.surface ??
      SURFACE_LABELS[record.surface] ??
      record.surface.replace(/^\w/, (letter) => letter.toUpperCase());
    const postures = sourceEntry?.postures?.map(
      (posture) => POSTURE_LABELS[posture.toLowerCase()] ?? posture.toLowerCase(),
    );
    const figures = sourceEntry?.figures ?? record.scene.actors.length;
    const postureText = postures?.length
      ? [...new Set(postures)].join(" and ")
      : record.scene.actors
          .map((actor) => POSTURE_LABELS[actor.posture] ?? actor.posture)
          .join(" and ");
    const title = record.title;
    const label = templateLabel(
      record.template === "group_three" ? record.base : record.template,
    );
    const warnings = [INTERACTION_NOTE];
    if (!record.checks.passed) warnings.push(`Some interaction checks are unmet: ${record.checks.failures.join("; ")}.`);
    if (record.note) warnings.push(record.note);
    const preset = checkPreset({
      id: positionId(record.sourceId),
      title,
      description: `${name}: ${label}.${record.aliases?.length ? ` Also known as ${record.aliases.join(", ")}.` : ""} ${figures} clothed ${figures === 1 ? "figure" : "figures"} in ${postureText} positions ${SURFACE_PHRASES[surface] ?? `on ${surface.toLowerCase()}`}. Approximate template-based 3D interpretation of source ${record.sourceId}.`,
      category,
      position: {
        type,
        name,
        variant: "interaction",
      },
      tags: [
        "interaction",
        "position",
        record.template,
        record.surface,
        record.sourceId,
        category,
        name,
        ...(record.aliases ?? []),
      ],
      source: { dataset: "SexPoses", recordId: record.sourceId, annotationHash: record.annotationHash },
      scene: { ...structuredClone(record.scene), title },
    });
    out.push({ ...preset, inputWarnings: warnings });
  }
  return out;
}

export const templateLabel = (template) => TEMPLATE_LABELS[template] ?? TEMPLATE_LABELS.other_pair;

export const isInteractionPosition = (preset) =>
  isPositionVariant(preset, "interaction");

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
  const titles = new Set();
  for (const record of pack.studies) {
    const entry = sources.get(record?.sourceId);
    if (
      !entry ||
      studies.has(record.sourceId) ||
      record.annotationHash !== entry.annotationHash ||
      !TEMPLATE_IDS.has(record.template) ||
      (record.template === "group_three" && !TEMPLATE_LABELS[record.base]) ||
      typeof record.title !== "string" ||
      !record.title.trim() ||
      record.title.length > 80 ||
      titles.has(record.title.toLocaleLowerCase()) ||
      (record.aliases !== undefined &&
        (!Array.isArray(record.aliases) ||
          record.aliases.length > 4 ||
          record.aliases.some((alias) => typeof alias !== "string" || !alias.trim() || alias.length > 32))) ||
      typeof record.checks?.passed !== "boolean" ||
      !Array.isArray(record.checks.failures) ||
      record.checks.failures.some((f) => typeof f !== "string" || f.length > 120)
    )
      throw new Error("Invalid or duplicate interaction source mapping.");
    const scene = checkScene(record.scene);
    checkFixedPositionScene(scene);
    titles.add(record.title.toLocaleLowerCase());
    studies.set(record.sourceId, { ...record, scene });
  }
  return studies;
}

export function interactionPreset(entry, studies) {
  const record = studies.get(entry.sourceId);
  if (!record) throw new Error("Interaction position unavailable for this source.");
  return interactionPositions(new Map([[entry.sourceId, record]]), [entry])[0];
}
