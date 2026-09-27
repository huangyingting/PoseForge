/** Portable, versioned scene presets. No browser or renderer dependencies. */
import {
  validateScene,
  BODY_TYPES,
  JOINT_MODES,
  MAX_CONTACT_TYPE_LENGTH,
  MAX_SCENE_ACTORS,
  MIN_SCENE_ACTORS,
} from "./scene.js";
import {
  POSTURE_NAMES,
  ARRANGEMENT_NAMES,
  SURFACE_NAMES,
  resolveArrangement,
} from "./poseLibrary.js";
import { ARCHETYPES } from "../nlp/archetypes.js";
import { applyPresetLayout } from "../nlp/presetLayouts.js";
import { HAIR_STYLES } from "./hair.js";
import { BODY_MODELS } from "./bodyModels.js";
import { GARMENT_COLOURS } from "./garments.js";
import { HAND_SHAPE_NAMES } from "./handPose.js";
import { FOOT_SHAPE_NAMES } from "./footPose.js";
import { currentPreset } from "./datasetImages.js";
import {
  checkPositionMetadata,
} from "./positionContract.js";

export const CATALOG_FORMAT = "poseforge.catalog";
export const CATALOG_VERSION = 1;
export const MAX_PACK_BYTES = 32_000_000;
export const MAX_PRESETS = 5000;
export const CAMERA_VIEWS = ["three_quarter", "front", "side", "top"];

const record = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const fail = (message) => {
  throw new Error(message);
};
function boundedText(value, name, max, required = false) {
  if (value == null && !required) return "";
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  ) {
    fail(
      `${name} must be ${required ? "non-empty text" : "text"} up to ${max} characters.`,
    );
  }
  return value.trim();
}

/** Reject non-JSON values, dangerous keys, deep and oversized structures. */
function checkTree(value, depth = 0) {
  if (depth > 12) fail("Preset data is nested too deeply.");
  if (typeof value === "number" && !Number.isFinite(value))
    fail("Numbers must be finite.");
  if (value === null || ["string", "boolean", "number"].includes(typeof value))
    return;
  if (typeof value !== "object")
    fail("Preset data must contain only JSON values.");
  if (Array.isArray(value) && value.length > 300) fail("A list is too large.");
  for (const [key, child] of Object.entries(value)) {
    if (["__proto__", "constructor", "prototype"].includes(key))
      fail("Unsafe property in preset data.");
    checkTree(child, depth + 1);
  }
}

/** Strict at the interchange boundary; the interactive parser remains forgiving. */
export function checkScene(input) {
  if (
    !record(input) ||
    !Array.isArray(input.actors) ||
    input.actors.length < MIN_SCENE_ACTORS ||
    input.actors.length > MAX_SCENE_ACTORS
  ) {
    fail(
      `A scene needs between ${MIN_SCENE_ACTORS} and ${MAX_SCENE_ACTORS} figures.`,
    );
  }
  checkTree(input);
  for (const [key, limit] of [
    ["id", 100],
    ["title", 80],
    ["description", 5000],
  ])
    boundedText(input[key], `Scene ${key}`, limit);
  for (const field of ["support", "relationship", "camera"]) {
    if (input[field] != null && !record(input[field]))
      fail(`Scene ${field} must be an object.`);
  }
  if (input.support?.surface && !SURFACE_NAMES.includes(input.support.surface))
    fail("Unknown scene surface.");
  if (
    input.relationship?.arrangement &&
    !ARRANGEMENT_NAMES.includes(input.relationship.arrangement)
  )
    fail("Unknown arrangement.");
  if (
    input.relationship?.yaw != null &&
    (typeof input.relationship.yaw !== "number" ||
      Math.abs(input.relationship.yaw) > 360)
  )
    fail("Facing must be a number from -360 to 360.");
  if (input.camera?.view != null && !CAMERA_VIEWS.includes(input.camera.view))
    fail("Unknown camera view.");
  if (
    input.relationship?.contactMode != null &&
    !["automatic", "custom"].includes(input.relationship.contactMode)
  )
    fail("Contact mode must be automatic or custom.");
  const ids = new Set();
  for (const [index, actor] of input.actors.entries()) {
    if (!record(actor)) fail("Every figure must be an object.");
    if (!POSTURE_NAMES.includes(actor.posture))
      fail(`Figure ${index + 1}: unknown posture.`);
    if (actor.bodyType != null && !BODY_TYPES.includes(actor.bodyType))
      fail("Unknown body type.");
    if (actor.jointMode != null && !JOINT_MODES.includes(actor.jointMode))
      fail("Joint mode must be guided or fixed.");
    for (const [key, lo, hi] of [
      ["stature", 1.4, 2.1],
      ["build", 0.8, 1.3],
      ["bust", 0, 2],
      ["mobility", 0, 1],
    ]) {
      if (
        actor[key] != null &&
        (typeof actor[key] !== "number" || actor[key] < lo || actor[key] > hi)
      )
        fail(`Figure ${index + 1}: ${key} must be ${lo}–${hi}.`);
    }
    if (actor.skinTone != null && !/^#[0-9a-f]{6}$/i.test(actor.skinTone))
      fail("Skin tone must be a six-digit hex color.");
    if (actor.model != null && !Object.hasOwn(BODY_MODELS, actor.model))
      fail("Unknown body model.");
    if (actor.hair != null && !Object.hasOwn(HAIR_STYLES, actor.hair))
      fail("Unknown hairstyle.");
    if (actor.outfit != null && !Object.hasOwn(GARMENT_COLOURS, actor.outfit))
      fail("Unknown clothing color.");
    for (const key of ["hands", "feet"]) {
      const value = actor[key];
      if (
        value != null &&
        typeof value !== "string" &&
        (!record(value) ||
          Object.values(value).some((v) => typeof v !== "string"))
      )
        fail(`Invalid ${key} shape.`);
      if (
        record(value) &&
        Object.keys(value).some((side) => !["l", "r"].includes(side))
      )
        fail(`Invalid ${key} side.`);
      const names = key === "hands" ? HAND_SHAPE_NAMES : FOOT_SHAPE_NAMES;
      if (
        value != null &&
        (typeof value === "string" ? [value] : Object.values(value)).some(
          (name) => !names.includes(name),
        )
      )
        fail(`Unknown ${key} shape.`);
    }
    if (actor.joints != null && !record(actor.joints))
      fail("Joints must be an object.");
    if (
      actor.wearing != null &&
      (!Array.isArray(actor.wearing) ||
        actor.wearing.some((v) => typeof v !== "string"))
    )
      fail("Wearing must be a list of garments.");
    boundedText(actor.label, "Figure name", 80);
    const id = actor.id ?? `actor${index}`;
    boundedText(id, "Figure ID", 100, true);
    if (ids.has(id)) fail("Figure IDs must be unique.");
    ids.add(id);
  }
  if (
    input.contacts != null &&
    (!Array.isArray(input.contacts) || input.contacts.length > 32)
  )
    fail("Contacts must be a list of at most 32 entries.");
  for (const contact of input.contacts ?? []) {
    if (!record(contact)) fail("Every contact must be an object.");
    if (contact.type != null)
      boundedText(contact.type, "Contact type", MAX_CONTACT_TYPE_LENGTH, true);
    if (
      contact.strength != null &&
      (typeof contact.strength !== "number" ||
        contact.strength < 0 ||
        contact.strength > 1)
    )
      fail("Contact strength must be 0–1.");
    for (const key of ["fromActor", "toActor"]) {
      if (typeof contact[key] === "number" && !Number.isInteger(contact[key]))
        fail("Contact figure indices must be integers.");
    }
  }
  const checked = validateScene(structuredClone(input));
  if (checked.issues.length)
    fail(checked.issues.map((issue) => issue.message).join(" "));
  // Strip undefined optional properties: the public contract is JSON.
  return JSON.parse(JSON.stringify(checked.scene));
}

export function checkPreset(input) {
  if (!record(input)) fail("Every preset must be an object.");
  checkTree(input);
  for (const field of [
    "figures",
    "surface",
    "positionName",
    "positionCategory",
    "reference",
  ])
    if (Object.hasOwn(input, field))
      fail(`Preset field "${field}" is not part of the position contract.`);
  const id = boundedText(input.id, "Preset ID", 100, true);
  if (!/^[a-z0-9][a-z0-9_.-]*$/i.test(id))
    fail("Preset IDs may use letters, numbers, dots, dashes and underscores.");
  if (!Array.isArray(input.tags) || input.tags.length > 12)
    fail("Tags must be a list of at most 12 items.");
  const source = input.source == null ? null : checkSource(input.source);
  const title = boundedText(input.title, "Title", 80, true);
  const category = boundedText(input.category, "Category", 40, true);
  const scene = checkScene(input.scene);
  const position = checkPositionMetadata(
    input.position ?? {
      type: "custom",
      name: title,
      variant: "studio",
    },
  );
  return {
    id,
    title,
    description: boundedText(input.description, "Description", 500),
    category,
    tags: [
      ...new Set(input.tags.map((tag) => boundedText(tag, "Tag", 32, true))),
    ],
    scene,
    ...(source ? { source } : {}),
    position,
  };
}

/** Provenance is descriptive metadata, never a transferable verification badge. */
export function checkSource(input) {
  if (
    !record(input) ||
    input.dataset !== "SexPoses" ||
    typeof input.recordId !== "string" ||
    typeof input.annotationHash !== "string" ||
    !/^[a-z0-9][a-z0-9_.-]{0,99}$/i.test(input.recordId ?? "") ||
    !/^[a-f0-9]{64}$/.test(input.annotationHash ?? "")
  )
    fail("Invalid source reference.");
  return {
    dataset: "SexPoses",
    recordId: input.recordId,
    annotationHash: input.annotationHash,
  };
}

function checkedEntries(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_PRESETS)
    fail(`A catalog needs 1–${MAX_PRESETS} presets.`);
  // A pack exported before positions were renamed still imports, as the
  // positions it names are now called.
  const presets = Array.from(input, (preset) => checkPreset(currentPreset(preset)));
  if (new Set(presets.map((p) => p.id)).size !== presets.length)
    fail("The catalog contains duplicate preset IDs.");
  return presets;
}

export function parseCatalog(text) {
  if (
    typeof text !== "string" ||
    new TextEncoder().encode(text).length > MAX_PACK_BYTES
  )
    fail("Catalog files must be no larger than 32 MB.");
  let pack;
  try {
    pack = JSON.parse(text);
  } catch {
    fail("This is not valid JSON.");
  }
  if (pack?.format !== CATALOG_FORMAT || pack.version !== CATALOG_VERSION)
    fail("Expected a PoseForge catalog with version 1.");
  return checkedEntries(pack.presets);
}

export function serializeCatalog(presets) {
  const pack = {
    format: CATALOG_FORMAT,
    version: CATALOG_VERSION,
    presets: checkedEntries(presets),
  };
  const encoder = new TextEncoder();
  const pretty = JSON.stringify(pack, null, 2);
  if (encoder.encode(pretty).length <= MAX_PACK_BYTES) return pretty;
  const compact = JSON.stringify(pack);
  if (encoder.encode(compact).length <= MAX_PACK_BYTES) return compact;
  fail(
    "This catalog exceeds 32 MB. Export individual presets or a smaller library.",
  );
}

export function searchCatalog(
  presets,
  { query = "", category = "all", scope = "all", favorites = [] } = {},
) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const listed = presets.filter((preset) => {
    const haystack = [
      preset.title,
      preset.description,
      preset.category,
      ...preset.tags,
      ...preset.scene.actors.map((a) => a.posture),
      preset.source?.recordId ?? "",
      preset.source?.dataset ?? "",
    ]
      .join(" ")
      .toLocaleLowerCase();
    return (
      (category === "all" || preset.category === category) &&
      (scope !== "positions" || preset.id.startsWith("builtin.")) &&
      (scope !== "named" ||
        preset.id.startsWith("builtin.named.") ||
        preset.id.startsWith("builtin.position.")) &&
      (scope !== "saved" || preset.id.startsWith("user.")) &&
      (scope !== "favorites" || favorites.includes(preset.id)) &&
      words.every((word) => haystack.includes(word))
    );
  });
  // Position IDs are names, and a name is often part of others' names and
  // descriptions ("squat" of "deep-squat"): a search for an ID lists that
  // position first.
  if (words.length !== 1) return listed;
  const named = (preset) =>
    preset.id.split(".").at(-1).toLocaleLowerCase() === words[0] ||
    preset.source?.recordId?.toLocaleLowerCase() === words[0];
  return [...listed.filter(named), ...listed.filter((preset) => !named(preset))];
}

function freeze(value) {
  Object.values(value).forEach((child) => {
    if (child && typeof child === "object") freeze(child);
  });
  return Object.freeze(value);
}

const figure = (bodyType, posture = "standing") => ({
  id: bodyType,
  label: bodyType === "female" ? "Figure A" : "Figure B",
  bodyType,
  posture,
  wearing: ["top", "shorts"],
  outfit: bodyType === "female" ? "sage" : "navy",
});
const preset = (
  id,
  title,
  category,
  description,
  actors,
  surface = "floor",
  tags = [],
  sceneOverrides = {},
) => ({
  id: `builtin.${id}`,
  title,
  category,
  description,
  tags,
  position: {
    type: id,
    name: title,
    variant: "studio",
  },
  scene: {
    title,
    description,
    actors,
    support: { surface },
    relationship: actors.length > 1 ? { arrangement: "side_by_side" } : {},
    contacts: [],
    camera: { view: "three_quarter" },
    ...sceneOverrides,
  },
});

export const STUDIO_PRESETS = freeze([
  preset(
    "together",
    "Side by side",
    "Together",
    "A relaxed standing study with two figures.",
    [figure("female"), figure("male")],
    "floor",
    ["pair", "standing"],
  ),
  preset(
    "standing-female",
    "Standing · female",
    "Standing",
    "A natural standing pose. A simple starting point for a new study.",
    [figure("female")],
    "floor",
    ["solo", "balance"],
  ),
  preset(
    "standing-male",
    "Standing · male",
    "Standing",
    "A neutral standing study with a relaxed stance.",
    [figure("male")],
    "floor",
    ["solo", "balance"],
  ),
  preset(
    "seated-female",
    "Take a seat",
    "Seated",
    "An upright chair study with grounded feet.",
    [figure("female", "seated")],
    "chair",
    ["solo", "chair"],
  ),
  preset(
    "seated-male",
    "Seated · male",
    "Seated",
    "A seated figure, ready for hand and arm adjustments.",
    [figure("male", "seated")],
    "chair",
    ["solo", "chair"],
  ),
  preset(
    "reclined",
    "Slow afternoon",
    "Seated",
    "A relaxed, leaning-back study on the sofa.",
    [figure("female", "seated_reclined")],
    "sofa",
    ["solo", "relaxed"],
  ),
  preset(
    "kneeling",
    "Tall kneel",
    "Floor",
    "An upright kneeling study with relaxed arms.",
    [figure("male", "kneeling")],
    "floor",
    ["solo", "kneeling"],
  ),
  preset(
    "low-kneel",
    "Resting kneel",
    "Floor",
    "A low kneeling figure, sitting back toward the heels.",
    [figure("female", "kneeling_low")],
    "floor",
    ["solo", "kneeling"],
  ),
  preset(
    "floor-rest",
    "Floor study",
    "Floor",
    "A supported reclining study on the floor.",
    [figure("male", "reclined")],
    "floor",
    ["solo", "reclining"],
  ),
  preset(
    "paired-kneel",
    "A quiet moment",
    "Together",
    "Two upright kneeling figures arranged alongside one another.",
    [figure("female", "kneeling"), figure("male", "kneeling")],
    "floor",
    ["pair", "kneeling"],
  ),
  preset(
    "helping-hand",
    "A helping hand",
    "Together",
    "A standing gesture with a hand reaching toward a partner’s forearm.",
    [figure("female"), figure("male")],
    "floor",
    ["pair", "gesture"],
    {
      relationship: { arrangement: "side_by_side", contactMode: "custom" },
      contacts: [
        {
          fromActor: 0,
          toActor: 1,
          from: "hand.r",
          to: "forearm.l",
          strength: 1,
          type: "rest",
        },
      ],
    },
  ),
]);

/** Adapt existing named definitions as data, without reparsing their titles. */
export function presetFromArchetype(definition) {
  const title = definition.id
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
  const baseYaw = resolveArrangement(definition.arrangement)?.yaw ?? 180;
  const yaw = definition.facing
    ? definition.facing === "away"
      ? (baseYaw + 180) % 360
      : baseYaw
    : definition.yaw;
  const draft = {
    title,
    description: definition.phrases[0],
    actors: definition.actors.map((actor, index) => ({
      ...actor,
      id: `actor${index}`,
      label: `Figure ${String.fromCharCode(65 + index)}`,
      wearing: ["top", "shorts"],
      outfit: index % 2 ? "navy" : "sage",
    })),
    relationship: {
      arrangement: definition.arrangement,
      ...(yaw != null ? { yaw } : {}),
    },
    support: { surface: definition.surface },
    contacts: structuredClone(definition.contacts ?? []),
    camera: definition.layout?.camera ?? { view: "three_quarter" },
  };
  const checked = validateScene(applyPresetLayout(draft, definition).scene);
  if (checked.issues.length)
    throw new Error(
      `${definition.id}: ${checked.issues.map((issue) => issue.message).join(" ")}`,
    );
  const posture = definition.actors[0].posture;
  const category =
    definition.surface === "table" ||
    definition.arrangement === "supported_lift"
      ? "Supported"
      : posture === "side_lying"
        ? "Side-lying"
        : ["supine", "prone", "reclined", "supine_legs_raised"].includes(
              posture,
            )
          ? "Reclining"
          : posture.startsWith("seated")
            ? "Seated"
            : ["kneeling", "all_fours", "kneeling_low"].includes(posture)
              ? "Kneeling"
              : "Standing";
  return checkPreset({
    id: `builtin.named.${definition.id}`,
    title,
    description: definition.label,
    category,
    tags: ["named", "pair", ...definition.phrases],
    position: {
      type: definition.id,
      name: title,
      variant: "studio",
    },
    scene: JSON.parse(JSON.stringify(checked.scene)),
  });
}

export const NAMED_PRESETS = freeze(ARCHETYPES.map(presetFromArchetype));
export const BUILTIN_PRESETS = freeze([...STUDIO_PRESETS, ...NAMED_PRESETS]);
